import Foundation
import Darwin

/// One desktop owner across the two apps. Lock lifetime is bound to the open
/// descriptor, so a crash automatically frees it without stale PID files.
final class OasisDesktopOwnership {
 private let path:URL
 private var descriptor:Int32 = -1
 init(path:URL?=nil){self.path=path ?? FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("Oasis Shared/desktop-owner.lock")}
 var held:Bool {descriptor >= 0}
 func claim()->Bool {
  if held{return true}
  do{try FileManager.default.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])}catch{return false}
  let fd=open(path.path,O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0o600)
  guard fd>=0 else{return false};var info=stat()
  guard fstat(fd,&info)==0,(info.st_mode&S_IFMT)==S_IFREG,info.st_uid==getuid(),info.st_nlink==1,flock(fd,LOCK_EX|LOCK_NB)==0 else{close(fd);return false}
  descriptor=fd;return true
 }
 func release(){if held{_ = flock(descriptor,LOCK_UN);close(descriptor);descriptor = -1}}
 deinit {release()}
}
