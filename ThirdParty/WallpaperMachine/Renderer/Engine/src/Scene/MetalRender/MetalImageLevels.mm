#include "MetalImageLevels.hpp"

#include <algorithm>
#include <vector>

namespace wallpaper::metal
{

namespace
{
// Levels a `width` x `height` texture can have: the chain halves down to 1x1.
NSUInteger LevelLimit(NSUInteger width, NSUInteger height)
{
    NSUInteger levels = 1;
    for (NSUInteger side = std::max(width, height); side > 1; side >>= 1) ++levels;
    return levels;
}
} // namespace

NSUInteger ImageTextureLevels(std::size_t levels, NSUInteger width, NSUInteger height)
{
    return std::min<NSUInteger>(levels, LevelLimit(width, height));
}

id<MTLTexture> MakeImageTexture(id<MTLDevice> device, MTLPixelFormat format, const Image::Slot& slot,
                                uint32_t bytes_per_pixel, uint32_t block_bytes)
{
    if (slot.width <= 0 || slot.height <= 0 || slot.mipmaps.empty()) return nil;
    const NSUInteger      levels =
        ImageTextureLevels(slot.mipmaps.size(), (NSUInteger)slot.width, (NSUInteger)slot.height);
    MTLTextureDescriptor* descriptor =
        [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format
                                                           width:(NSUInteger)slot.width
                                                          height:(NSUInteger)slot.height
                                                       mipmapped:levels > 1];
    descriptor.mipmapLevelCount = levels;
    descriptor.usage            = MTLTextureUsageShaderRead;
    // Shared storage, so the pixels are written straight into the texture.
    // A staging buffer plus a blit would need the frame to wait on an
    // upload, which is exactly what the per-frame path must never do.
    descriptor.storageMode = MTLStorageModeShared;

    id<MTLTexture> made = [device newTextureWithDescriptor:descriptor];
    if (made == nil) return nil;
    return UploadImageLevels(made, slot, bytes_per_pixel, block_bytes) ? made : nil;
}

bool LevelIsWrittenWhole(id<MTLTexture> texture, const ImageData& mipmap, NSUInteger level,
                         uint32_t block_bytes)
{
    if (mipmap.width <= 0 || mipmap.height <= 0 || level >= texture.mipmapLevelCount) return false;
    const NSUInteger extent_wide = std::max<NSUInteger>(1, texture.width >> level);
    const NSUInteger extent_high = std::max<NSUInteger>(1, texture.height >> level);
    const NSUInteger wide        = (NSUInteger)mipmap.width;
    const NSUInteger high        = (NSUInteger)mipmap.height;
    if (wide > extent_wide || high > extent_high) return false;
    return block_bytes == 0 ||
           ((wide % 4 == 0 || wide == extent_wide) && (high % 4 == 0 || high == extent_high));
}

bool UploadImageLevels(id<MTLTexture> texture, const Image::Slot& slot, uint32_t bytes_per_pixel,
                       uint32_t block_bytes)
{
    struct Write {
        NSUInteger     level;
        MTLRegion      region;
        NSUInteger     bytes_per_row;
        const uint8_t* bytes;
    };
    // Every level is checked before any is written, so a refused one leaves a texture that is
    // already shown exactly as it was.
    std::vector<Write> writes;
    const NSUInteger   levels = std::min<NSUInteger>(slot.mipmaps.size(), texture.mipmapLevelCount);
    for (NSUInteger level = 0; level < levels; ++level) {
        const auto& mipmap = slot.mipmaps[level];
        if (mipmap.data == nullptr || mipmap.width <= 0 || mipmap.height <= 0) continue;
        // A level is written inside its own extent in the texture, whatever size the file
        // gives it; its rows keep the stride of the size it has.
        const NSUInteger extent_wide = std::max<NSUInteger>(1, texture.width >> level);
        const NSUInteger extent_high = std::max<NSUInteger>(1, texture.height >> level);
        const NSUInteger wide        = std::min<NSUInteger>((NSUInteger)mipmap.width, extent_wide);
        const NSUInteger high        = std::min<NSUInteger>((NSUInteger)mipmap.height, extent_high);
        NSUInteger       bytes_per_row = (NSUInteger)mipmap.width * bytes_per_pixel;
        NSUInteger       rows          = high;
        if (block_bytes > 0) {
            // Blocks are written whole, except where they meet the level's own edge.
            if ((wide % 4 != 0 && wide != extent_wide) || (high % 4 != 0 && high != extent_high)) continue;
            bytes_per_row = (((NSUInteger)mipmap.width + 3) / 4) * block_bytes;
            rows          = (high + 3) / 4;
        }
        // A level shorter than the rows the copy reads would be read past its end.
        if (mipmap.size < 0 || (NSUInteger)mipmap.size < bytes_per_row * rows) return false;
        writes.push_back({ level, MTLRegionMake2D(0, 0, wide, high), bytes_per_row, mipmap.data.get() });
    }
    for (const Write& write : writes) {
        [texture replaceRegion:write.region
                   mipmapLevel:write.level
                     withBytes:write.bytes
                   bytesPerRow:write.bytes_per_row];
    }
    return true;
}

} // namespace wallpaper::metal
