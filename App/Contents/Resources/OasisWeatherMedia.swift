import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// A separate CLI invocation prepares only the selected local background. It
/// never creates NSApplication, audio output, player controls or network URLs.
enum OasisWeatherMedia {
 static func run() -> Int32 {
  let args=Array(CommandLine.arguments.dropFirst())
  guard args.count==5,args[0]=="--prepare-weather-media",["gif","video"].contains(args[1]) else { return 64 }
  let source=URL(fileURLWithPath:args[2]),poster=URL(fileURLWithPath:args[3]),output=URL(fileURLWithPath:args[4])
  guard source.deletingLastPathComponent()==poster.deletingLastPathComponent(),poster.deletingLastPathComponent()==output.deletingLastPathComponent(),
        !FileManager.default.fileExists(atPath:poster.path),!FileManager.default.fileExists(atPath:output.path) else{return 64}
  do {
   let info=try source.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])
   guard info.isRegularFile==true,info.isSymbolicLink != true,(info.fileSize ?? 0)>0,(args[1]=="video" || (info.fileSize ?? Int.max)<=20*1024*1024) else {throw problem()}
   let result=args[1]=="gif" ? try gif(source:source,poster:poster,output:output) : try video(source:source,poster:poster,output:output)
   let data=try JSONSerialization.data(withJSONObject:result,options:.sortedKeys);FileHandle.standardOutput.write(data);return 0
  }catch{try? FileManager.default.removeItem(at:poster);try? FileManager.default.removeItem(at:output);FileHandle.standardError.write(Data("Background media could not be prepared\n".utf8));return 1}
 }
 private static func problem()->NSError {NSError(domain:"OasisWeatherMedia",code:1)}
 static func backgroundFrameDuration(nominalRate:Float,minimum:CMTime)->CMTime {
  let seconds=CMTimeGetSeconds(minimum)
  if seconds.isFinite,seconds>0 {return seconds<1.0/60.0 ? CMTime(value:1,timescale:60):minimum}
  let rate=nominalRate.isFinite&&nominalRate>0 ? min(60,Double(nominalRate)):30
  return CMTime(seconds:1/rate,preferredTimescale:600000)
 }
 private static func jpeg(_ image:CGImage,to url:URL)throws {
  guard let destination=CGImageDestinationCreateWithURL(url as CFURL,UTType.jpeg.identifier as CFString,1,nil) else {throw problem()}
  CGImageDestinationAddImage(destination,image,[kCGImageDestinationLossyCompressionQuality:0.86] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {throw problem()}
 }
 private static func gif(source:URL,poster:URL,output:URL)throws->[String:Any] {
  guard let data=CGImageSourceCreateWithURL(source as CFURL,[kCGImageSourceShouldCache:false] as CFDictionary),
        CGImageSourceGetType(data) as String? == UTType.gif.identifier else {throw problem()}
  let count=CGImageSourceGetCount(data);guard count>0,count<=600 else {throw problem()}
  var pixels=0,width=0,height=0
  for i in 0..<count {
   guard let properties=CGImageSourceCopyPropertiesAtIndex(data,i,nil) as? [CFString:Any],let w=properties[kCGImagePropertyPixelWidth] as? Int,let h=properties[kCGImagePropertyPixelHeight] as? Int,w>0,h>0,w<=3840,h<=3840 else {throw problem()}
   pixels += w*h;guard pixels<=600_000_000 else {throw problem()};if i==0{width=w;height=h}
  }
  guard max(width,height)>=320,min(width,height)>=240,
        let image=CGImageSourceCreateThumbnailAtIndex(data,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:3840,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else {throw problem()}
  // Keep the compressed frames, palette, transparency and disposal untouched.
  // The local media store replaces only the GIF loop extension after decoding.
  try FileManager.default.copyItem(at:source,to:output)
  try jpeg(image,to:poster);return ["width":image.width,"height":image.height,"mediaType":"gif","mediaExtension":"gif"]
 }
 private static func video(source:URL,poster:URL,output:URL)throws->[String:Any] {
  let asset=AVURLAsset(url:source,options:[AVURLAssetReferenceRestrictionsKey:AVAssetReferenceRestrictions.forbidAll.rawValue])
  let duration=CMTimeGetSeconds(asset.duration)
  guard duration.isFinite,duration>0,let track=asset.tracks(withMediaType:.video).first else {throw problem()}
  let oriented=CGRect(origin:.zero,size:track.naturalSize).applying(track.preferredTransform),w=abs(oriented.width),h=abs(oriented.height)
  guard w.isFinite,h.isFinite,max(w,h)>=320,min(w,h)>=240,w<=8192,h<=8192 else {throw problem()}
  let composition=AVMutableComposition()
  guard let video=composition.addMutableTrack(withMediaType:.video,preferredTrackID:kCMPersistentTrackID_Invalid) else {throw problem()}
  try video.insertTimeRange(CMTimeRange(start:.zero,duration:asset.duration),of:track,at:.zero)
  // Keep the wallpaper's own first audio track, including its original timing.
  // Playback is opt-in and never controls the user's music player.
  let sourceAudio=asset.tracks(withMediaType:.audio).first
  if let sourceAudio {
   guard let sound=composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid) else {throw problem()}
   let start=CMTimeMaximum(.zero,sourceAudio.timeRange.start)
   let end=CMTimeMinimum(asset.duration,CMTimeRangeGetEnd(sourceAudio.timeRange))
   guard CMTimeCompare(end,start)>0 else {throw problem()}
   try sound.insertTimeRange(CMTimeRange(start:start,duration:CMTimeSubtract(end,start)),of:sourceAudio,at:start)
  }
  let scale=min(1,1920/max(w,h)),size=CGSize(width:max(2,floor(w*scale/2)*2),height:max(2,floor(h*scale/2)*2))
  let instruction=AVMutableVideoCompositionInstruction();instruction.timeRange=CMTimeRange(start:.zero,duration:composition.duration)
  let layer=AVMutableVideoCompositionLayerInstruction(assetTrack:video)
  let transform=track.preferredTransform.concatenating(CGAffineTransform(translationX:-oriented.minX,y:-oriented.minY)).concatenating(CGAffineTransform(scaleX:scale,y:scale))
  layer.setTransform(transform,at:.zero);instruction.layerInstructions=[layer]
  let rendering=AVMutableVideoComposition();rendering.instructions=[instruction];rendering.renderSize=size;rendering.frameDuration=backgroundFrameDuration(nominalRate:track.nominalFrameRate,minimum:track.minFrameDuration)
  let codec=track.formatDescriptions.first.map { CMFormatDescriptionGetMediaSubType($0 as! CMFormatDescription) }
  let passthrough=max(w,h)<=1920 && track.nominalFrameRate<=60 && (codec==kCMVideoCodecType_H264 || codec==kCMVideoCodecType_HEVC)
  video.preferredTransform=track.preferredTransform
  func export(_ copy:Bool)->Bool {
   guard let session=AVAssetExportSession(asset:composition,presetName:copy ? AVAssetExportPresetPassthrough : AVAssetExportPresetHighestQuality) else{return false}
   session.outputURL=output;session.outputFileType = .mp4;session.shouldOptimizeForNetworkUse=true;if !copy {session.videoComposition=rendering};session.metadata=[]
   let done=DispatchSemaphore(value:0);session.exportAsynchronously{done.signal()}
   guard done.wait(timeout:.now()+600) == .success else{session.cancelExport();return false};return session.status == .completed
  }
  if !export(passthrough) {try? FileManager.default.removeItem(at:output);guard passthrough && export(false) else {throw problem()}}
  let bytes=(try output.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? Int.max;guard bytes>0 else {throw problem()}
  let result=AVURLAsset(url:output),hasAudio = !result.tracks(withMediaType:.audio).isEmpty
  guard sourceAudio == nil || hasAudio else {throw problem()}
  let generator=AVAssetImageGenerator(asset:result);generator.appliesPreferredTrackTransform=true;generator.maximumSize=size
  let image=try generator.copyCGImage(at:.zero,actualTime:nil);try jpeg(image,to:poster)
  let preparedRate=result.tracks(withMediaType:.video).first?.nominalFrameRate ?? 0
  return ["width":image.width,"height":image.height,"duration":duration,"frameRate":preparedRate,"mediaType":"video","mediaExtension":"mp4","hasAudio":hasAudio]
 }
}
