import Foundation
import Darwin

// clonefile never falls back to a full copy. Each file is independent after
// cloning, and an unsupported filesystem returns an error to the caller.
enum OasisWallpaperClone {
 static func run()->Int32 {
  let args=Array(CommandLine.arguments.dropFirst());guard args.count==3,args[0]=="--clone-wallpaper-tree" else{return 64}
  let source=URL(fileURLWithPath:args[1]),destination=URL(fileURLWithPath:args[2]);var count=0
  func copy(_ from:URL,_ to:URL,_ depth:Int)throws {
   count += 1;guard count<=200000,depth<=48 else{throw CocoaError(.fileReadUnknown)}
   let attributes=try FileManager.default.attributesOfItem(atPath:from.path),type=attributes[.type] as? FileAttributeType
   if type == .typeDirectory {
    try FileManager.default.createDirectory(at:to,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
    for name in try FileManager.default.contentsOfDirectory(atPath:from.path){try copy(from.appendingPathComponent(name),to.appendingPathComponent(name),depth+1)}
   }else if type == .typeRegular {
    guard clonefile(from.path,to.path,UInt32(CLONE_NOFOLLOW))==0 else{throw CocoaError(.fileWriteUnknown)}
   }else{throw CocoaError(.fileReadUnknown)}
  }
  do {try copy(source,destination,0);return 0}catch{return 1}
 }
}
