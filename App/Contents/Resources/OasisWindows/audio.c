// A process-local gain stage for the Wine player's output. No system mixer
// settings or other applications' audio streams participate in this control.
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

static _Atomic(float) gain;
static _Atomic(unsigned) callbacks;
void oasis_audio_gain(float value) { atomic_store(&gain, isfinite(value) ? fminf(1, fmaxf(value, 0)) : 0); }
unsigned oasis_audio_callbacks(void) { return atomic_load(&callbacks); }
typedef struct Output {
    AudioUnit unit;
    AURenderCallbackStruct source;
    AudioStreamBasicDescription fmt;
    struct Output *next;
} Output;
static Output *outputs;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

static OSStatus render(void *cookie, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *time,
                       UInt32 bus, UInt32 frames, AudioBufferList *buffers) {
    Output *out = cookie;
    OSStatus status = out->source.inputProc(out->source.inputProcRefCon, flags, time, bus, frames, buffers);
    if (status != noErr || !buffers)
        return status;
    float volume = atomic_load_explicit(&gain, memory_order_relaxed);
    if (volume == 1)
        return noErr;
    const UInt32 bits = out->fmt.mBitsPerChannel, format = out->fmt.mFormatFlags;
    for (UInt32 i = 0; i < buffers->mNumberBuffers; i++) {
        AudioBuffer *buf = &buffers->mBuffers[i];
        uint8_t *data = buf->mData;
        UInt32 n = buf->mDataByteSize;
        if (!data)
            continue;
        if (volume == 0) {
            memset(data, bits == 8 && !(format & kAudioFormatFlagIsSignedInteger) ? 128 : 0, n);
            continue;
        }
        if (format & kAudioFormatFlagIsFloat) {
            if (bits == 32) {
                float *a = (float *)data;
                for (UInt32 j = 0; j < n / 4; j++)
                    a[j] *= volume;
            } else if (bits == 64) {
                double *a = (double *)data;
                for (UInt32 j = 0; j < n / 8; j++)
                    a[j] *= volume;
            }
        } else if (bits == 16) {
            int16_t *a = (int16_t *)data;
            for (UInt32 j = 0; j < n / 2; j++)
                a[j] = (int16_t)(a[j] * volume);
        } else if (bits == 32) {
            int32_t *a = (int32_t *)data;
            for (UInt32 j = 0; j < n / 4; j++)
                a[j] = (int32_t)(a[j] * (double)volume);
        } else if (bits == 24) {
            for (UInt32 j = 0; j + 2 < n; j += 3) {
                int32_t v = (int32_t)((uint32_t)data[j] << 8 | (uint32_t)data[j + 1] << 16 |
                                      (uint32_t)data[j + 2] << 24) >>
                            8;
                v = (int32_t)(v * volume);
                data[j] = v;
                data[j + 1] = v >> 8;
                data[j + 2] = v >> 16;
            }
        } else if (bits == 8) {
            int offset = (format & kAudioFormatFlagIsSignedInteger) ? 0 : 128;
            for (UInt32 j = 0; j < n; j++) {
                int v = offset ? data[j] : (int8_t)data[j];
                data[j] = (uint8_t)((v - offset) * volume + offset);
            }
        }
    }
    return noErr;
}
static OSStatus setProperty(AudioUnit unit, AudioUnitPropertyID property, AudioUnitScope scope,
                            AudioUnitElement bus, const void *value, UInt32 size) {
    if (property != kAudioUnitProperty_SetRenderCallback || scope != kAudioUnitScope_Input || !value ||
        size != sizeof(AURenderCallbackStruct) || !((AURenderCallbackStruct *)value)->inputProc)
        return AudioUnitSetProperty(unit, property, scope, bus, value, size);
    Output *out = calloc(1, sizeof(*out));
    if (!out)
        return kAudio_MemFullError;
    out->source = *(const AURenderCallbackStruct *)value;
    out->unit = unit;
    UInt32 len = sizeof(out->fmt);
    OSStatus status =
        AudioUnitGetProperty(unit, kAudioUnitProperty_StreamFormat, scope, bus, &out->fmt, &len);
    if (status != noErr || out->fmt.mFormatID != kAudioFormatLinearPCM) {
        free(out);
        return kAudioUnitErr_FormatNotSupported;
    }
    AURenderCallbackStruct wrapped = {render, out};
    status = AudioUnitSetProperty(unit, property, scope, bus, &wrapped, sizeof(wrapped));
    if (status != noErr) {
        free(out);
        return status;
    }
    pthread_mutex_lock(&lock);
    out->next = outputs;
    outputs = out;
    pthread_mutex_unlock(&lock);
    atomic_fetch_add(&callbacks, 1);
    return noErr;
}
static OSStatus disposeUnit(AudioComponentInstance unit) {
    pthread_mutex_lock(&lock);
    Output *retired = NULL, **p = &outputs;
    while (*p) {
        Output *next = *p;
        if (next->unit == unit) {
            *p = next->next;
            next->next = retired;
            retired = next;
        } else
            p = &next->next;
    }
    pthread_mutex_unlock(&lock);
    OSStatus status = AudioComponentInstanceDispose(unit);
    if (status == noErr)
        while (retired) {
            Output *next = retired->next;
            free(retired);
            retired = next;
        }
    else {
        pthread_mutex_lock(&lock);
        while (retired) {
            Output *next = retired->next;
            retired->next = outputs;
            outputs = retired;
            retired = next;
        }
        pthread_mutex_unlock(&lock);
    }
    return status;
}
static OSStatus setDevice(AudioObjectID device, const AudioObjectPropertyAddress *property, UInt32 qsize,
                          const void *qualifier, UInt32 size, const void *value) {
    if (property && (property->mSelector == kAudioDevicePropertyVolumeScalar ||
                     property->mSelector == kAudioDevicePropertyVolumeDecibels ||
                     property->mSelector == kAudioDevicePropertyMute ||
                     property->mSelector == kAudioHardwarePropertyDefaultOutputDevice))
        return kAudioHardwareUnsupportedOperationError;
    return AudioObjectSetPropertyData(device, property, qsize, qualifier, size, value);
}
#define LOCAL_BIND(newfn, oldfn)                                                                             \
    __attribute__((used, section("__DATA,__interpose"))) static const struct {                               \
        const void *replacement, *original;                                                                  \
    } bind_##newfn = {(const void *)newfn, (const void *)oldfn}
LOCAL_BIND(setProperty, AudioUnitSetProperty);
LOCAL_BIND(disposeUnit, AudioComponentInstanceDispose);
LOCAL_BIND(setDevice, AudioObjectSetPropertyData);
