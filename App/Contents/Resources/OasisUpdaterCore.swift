import Foundation
import Security
import CryptoKit

enum OasisUpdateError: Error, LocalizedError {
 case invalidRelease, missingChecksum, download, checksum, unsafeArchive, invalidSignature, incompatible, insufficientSpace, busy, permission, install
 var errorDescription: String? {
  switch self {
  case .invalidRelease: return "找不到可用的更新包。"
  case .missingChecksum: return "更新包缺少完整性資料，無法安全安裝。"
  case .download: return "無法下載更新，請稍後重試。"
  case .checksum: return "更新包驗證失敗，請稍後重試。"
  case .unsafeArchive: return "更新包內容不正確，已停止安裝。"
  case .invalidSignature: return "更新包的簽章與目前安裝的 App 不一致。"
  case .incompatible: return "更新包與目前的 App 或這台 Mac 不相容。"
  case .insufficientSpace: return "儲存空間不足，無法安裝更新。"
  case .busy: return "目前有操作正在執行，請完成後再檢查更新。"
  case .permission: return "目前的安裝位置無法寫入，請將 App 移至可寫入的「應用程式」資料夾後重試。"
  case .install: return "無法開始安裝更新，請稍後重試。"
  }
 }
}

struct OasisVersion: Comparable, Equatable {
 let parts: [Int]
 init?(_ input: String) {
  let raw=input.hasPrefix("v") ? String(input.dropFirst()):input
  let pieces=raw.split(separator:".",omittingEmptySubsequences:false)
  guard pieces.count==3 else{return nil}
  var numbers:[Int]=[]
  for p in pieces {
   guard !p.isEmpty,p.count<=6,p.allSatisfy({$0.isASCII && $0.isNumber}),let n=Int(p) else{return nil}
   numbers.append(n)
  }
  parts=numbers
 }
 static func < (lhs:Self,rhs:Self)->Bool {
  for (a,b) in zip(lhs.parts,rhs.parts) {if a != b{return a<b}}
  return false
 }
 var text:String {parts.map(String.init).joined(separator:".")}
}

struct OasisUpdateAsset {
 let id:Int64,name:String,size:Int64,digest:String?
}
struct OasisUpdateRelease {
 let version:OasisVersion,asset:OasisUpdateAsset,checksum:OasisUpdateAsset?
}

enum OasisUpdaterCore {
 static let maxArchive:Int64=4*1024*1024*1024-1
 static let maxExpanded:Int64=6*1024*1024*1024
 static func asset(_ value:[String:Any])->OasisUpdateAsset? {
  guard let number=value["id"] as? NSNumber,CFGetTypeID(number) != CFBooleanGetTypeID(),number.int64Value>0,
        let name=value["name"] as? String,name.count<=160,
        let size=value["size"] as? NSNumber,CFGetTypeID(size) != CFBooleanGetTypeID(),size.int64Value>0,size.int64Value<=maxArchive,
        value["state"] as? String=="uploaded" else{return nil}
  let digest=(value["digest"] as? String).flatMap { raw -> String? in
   guard raw.range(of:"^sha256:[0-9a-fA-F]{64}$",options:.regularExpression) != nil else{return nil}
   return String(raw.dropFirst(7)).lowercased()
  }
  return OasisUpdateAsset(id:number.int64Value,name:name,size:size.int64Value,digest:digest)
 }
 static func latest(_ data:Data,installed:String,assetPrefix:String="Oasis") throws -> OasisUpdateRelease? {
  guard data.count<=4_000_000,let current=OasisVersion(installed),let releases=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else{throw OasisUpdateError.invalidRelease}
  let candidates=releases.compactMap { row -> (OasisVersion,[[String:Any]])? in
   guard row["draft"] as? Bool==false,row["prerelease"] as? Bool==false,
         let tag=row["tag_name"] as? String,tag.hasPrefix("v"),let version=OasisVersion(tag),
         let assets=row["assets"] as? [[String:Any]],version>current else{return nil}
   return (version,assets)
  }.sorted{$0.0>$1.0}
  guard let (version,rows)=candidates.first else{return nil}
  let allowed=["\(assetPrefix)-v\(version.text)-universal.zip","\(assetPrefix)-v\(version.text)-macOS-universal.zip"]
  let assets=rows.compactMap(asset)
  guard let archive=allowed.compactMap({ name in assets.first(where:{$0.name==name}) }).first else{throw OasisUpdateError.invalidRelease}
  let checksum=assets.first(where:{["SHA256SUMS.txt","\(assetPrefix)-v\(version.text)-SHA256SUMS.txt"].contains($0.name) && $0.size<=262144})
  guard archive.digest != nil || checksum != nil else{throw OasisUpdateError.missingChecksum}
  return OasisUpdateRelease(version:version,asset:archive,checksum:checksum)
 }
 static func checksum(_ data:Data,filename:String)->String? {
  guard data.count<=262144,let text=String(data:data,encoding:.utf8) else{return nil}
  for line in text.components(separatedBy:.newlines) {
   let fields=line.split(maxSplits:1,whereSeparator:{$0==" " || $0=="\t"})
   guard fields.count==2 else{continue}
   let hash=String(fields[0]),name=String(fields[1]).trimmingCharacters(in:.whitespaces).trimmingCharacters(in:CharacterSet(charactersIn:"*"))
   if name==filename,hash.range(of:"^[a-fA-F0-9]{64}$",options:.regularExpression) != nil{return hash.lowercased()}
  }
  return nil
 }
 static func sha256(_ url:URL) throws -> String {
  let handle=try FileHandle(forReadingFrom:url);defer{try? handle.close()};var hash=SHA256()
  while let chunk=try handle.read(upToCount:1024*1024),!chunk.isEmpty{hash.update(data:chunk)}
  return hash.finalize().map{String(format:"%02x",$0)}.joined()
 }
 static func verifySignature(current:URL,candidate:URL) throws {
  var oldCode:SecStaticCode?,newCode:SecStaticCode?,requirement:SecRequirement?
  guard SecStaticCodeCreateWithPath(current as CFURL,[],&oldCode)==errSecSuccess,let oldCode,
        SecStaticCodeCheckValidity(oldCode,SecCSFlags(rawValue:kSecCSCheckAllArchitectures),nil)==errSecSuccess,
        SecCodeCopyDesignatedRequirement(oldCode,[],&requirement)==errSecSuccess,let requirement,
        SecStaticCodeCreateWithPath(candidate as CFURL,[],&newCode)==errSecSuccess,let newCode,
        SecStaticCodeCheckValidity(newCode,SecCSFlags(rawValue:kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate),requirement)==errSecSuccess
  else{throw OasisUpdateError.invalidSignature}
  var info:CFDictionary?
  guard SecCodeCopySigningInformation(oldCode,SecCSFlags(rawValue:kSecCSSigningInformation),&info)==errSecSuccess,
        let values=info as? [String:Any],let certificates=values[kSecCodeInfoCertificates as String] as? [SecCertificate],!certificates.isEmpty else{throw OasisUpdateError.invalidSignature}
 }

 /// Read the ZIP central directory before extracting anything. Only regular
 /// files and directories inside the expected app bundle and its AppleDouble metadata are
 /// accepted; local and central names must agree and links are never allowed.
 static func validateArchive(_ url:URL,bundleName:String="Oasis.app") throws -> Int64 {
  let file=try FileHandle(forReadingFrom:url);defer{try? file.close()}
  let size=try file.seekToEnd();guard size>=22,size<=UInt64(maxArchive) else{throw OasisUpdateError.unsafeArchive}
  func read(_ at:UInt64,_ count:Int) throws -> Data {
   guard count>=0,at<=size,UInt64(count)<=size-at else{throw OasisUpdateError.unsafeArchive}
   try file.seek(toOffset:at);guard let d=try file.read(upToCount:count),d.count==count else{throw OasisUpdateError.unsafeArchive};return d
  }
  func u16(_ d:Data,_ i:Int)throws->Int {guard i>=0,i+2<=d.count else{throw OasisUpdateError.unsafeArchive};return Int(d[i])|Int(d[i+1])<<8}
  func u32(_ d:Data,_ i:Int)throws->UInt32 {guard i>=0,i+4<=d.count else{throw OasisUpdateError.unsafeArchive};return UInt32(d[i])|UInt32(d[i+1])<<8|UInt32(d[i+2])<<16|UInt32(d[i+3])<<24}
  let tailLength=Int(min(size,65557)),tail=try read(size-UInt64(tailLength),tailLength);var end:Int?
  if tailLength>=22 {for i in stride(from:tailLength-22,through:0,by:-1){if try u32(tail,i)==0x06054b50, i+22+(try u16(tail,i+20))==tailLength {end=i;break}}}
  guard let e=end,try u16(tail,e+4)==0,try u16(tail,e+6)==0 else{throw OasisUpdateError.unsafeArchive}
  let count=try u16(tail,e+10),diskCount=try u16(tail,e+8),directorySize=try u32(tail,e+12),directoryOffset=try u32(tail,e+16)
  guard count>0,count<=20000,count==diskCount,directorySize<=32*1024*1024,directoryOffset != UInt32.max,directorySize != UInt32.max,
        UInt64(directoryOffset)+UInt64(directorySize)<=size-UInt64(tailLength)+UInt64(e) else{throw OasisUpdateError.unsafeArchive}
  let central=try read(UInt64(directoryOffset),Int(directorySize));var position=0,total:Int64=0,names=Set<String>(),hasApp=false,ranges:[Range<UInt64>]=[]
  for _ in 0..<count {
   guard try u32(central,position)==0x02014b50 else{throw OasisUpdateError.unsafeArchive}
   let flags=try u16(central,position+8),method=try u16(central,position+10),compressed=try u32(central,position+20),expanded=try u32(central,position+24)
   let nameLength=try u16(central,position+28),extraLength=try u16(central,position+30),commentLength=try u16(central,position+32),attributes=try u32(central,position+38),local=try u32(central,position+42)
   guard flags & 1 == 0,[0,8].contains(method),nameLength>0,compressed != UInt32.max,expanded != UInt32.max,local != UInt32.max,
         position+46+nameLength+extraLength+commentLength<=central.count else{throw OasisUpdateError.unsafeArchive}
   let bytes=central.subdata(in:position+46..<position+46+nameLength)
   guard let name=String(data:bytes,encoding:.utf8),name.utf8.count==nameLength,!name.hasPrefix("/"),!name.contains("\\"),
         !name.unicodeScalars.contains(where:{$0.value<32 || $0.value==127}) else{throw OasisUpdateError.unsafeArchive}
   let parts=name.split(separator:"/",omittingEmptySubsequences:false),trimmed=name.hasSuffix("/") ? Array(parts.dropLast()):parts
   guard !trimmed.isEmpty,trimmed.allSatisfy({!$0.isEmpty && $0 != "." && $0 != ".."}),
         trimmed[0]==Substring(bundleName) || trimmed[0]=="__MACOSX" && trimmed.count>=1 else{throw OasisUpdateError.unsafeArchive}
   if trimmed[0]=="__MACOSX",trimmed.count>1,trimmed[1] != Substring(bundleName) {throw OasisUpdateError.unsafeArchive}
   let normalized=name.precomposedStringWithCanonicalMapping.lowercased();guard names.insert(normalized).inserted else{throw OasisUpdateError.unsafeArchive}
   let mode=(attributes>>16)&0xf000;guard mode==0 || mode==0x4000 || mode==0x8000 else{throw OasisUpdateError.unsafeArchive}
   if trimmed[0]==Substring(bundleName) {hasApp=true}
   total += Int64(expanded);guard total<=maxExpanded else{throw OasisUpdateError.unsafeArchive}
   let header=try read(UInt64(local),30);guard try u32(header,0)==0x04034b50,try u16(header,6)==flags,try u16(header,8)==method else{throw OasisUpdateError.unsafeArchive}
   let localName=try u16(header,26),localExtra=try u16(header,28),payload=UInt64(local)+30+UInt64(localName)+UInt64(localExtra)
   guard localName==nameLength,try read(UInt64(local)+30,localName)==bytes,payload+UInt64(compressed)<=UInt64(directoryOffset) else{throw OasisUpdateError.unsafeArchive}
   ranges.append(UInt64(local)..<(payload+UInt64(compressed)))
   position += 46+nameLength+extraLength+commentLength
  }
  guard hasApp,position==central.count else{throw OasisUpdateError.unsafeArchive}
  ranges.sort{$0.lowerBound<$1.lowerBound};for i in 1..<ranges.count where ranges[i].lowerBound<ranges[i-1].upperBound {throw OasisUpdateError.unsafeArchive}
  return total
 }
}

final class OasisUpdateDownloadDelegate:NSObject,URLSessionDownloadDelegate,@unchecked Sendable {
 private let mirrorHost:String?
 let maximum:Int64
 let progress:@Sendable(Double)->Void
 private var last=Date.distantPast
 private let lock=NSLock()
 private var pending:CheckedContinuation<(URL,URLResponse),Error>?
 private var destination:URL?
 private var outcome:Result<(URL,URLResponse),Error>?
 init(maximum:Int64,mirrorHost:String?=nil,progress:@escaping @Sendable(Double)->Void){
  self.maximum=maximum;self.mirrorHost=mirrorHost;self.progress=progress
 }
 func download(_ session:URLSession,request:URLRequest,root:URL) async throws -> (URL,URLResponse) {
  try await withCheckedThrowingContinuation { continuation in
   lock.lock();precondition(pending == nil);pending=continuation;destination=root;outcome=nil;lock.unlock()
   session.downloadTask(with:request).resume()
  }
 }
 func urlSession(_ session:URLSession,downloadTask:URLSessionDownloadTask,didFinishDownloadingTo location:URL){
  lock.lock();defer{lock.unlock()}
  guard let root=destination,let response=downloadTask.response else{outcome = .failure(OasisUpdateError.download);return}
  do {let saved=root.appendingPathComponent("download-"+UUID().uuidString);try FileManager.default.moveItem(at:location,to:saved);outcome = .success((saved,response))}
  catch {outcome = .failure(error)}
 }
 func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){
  lock.lock();let continuation=pending;pending=nil;let result=error.map{Result<(URL,URLResponse),Error>.failure($0)} ?? outcome ?? .failure(OasisUpdateError.download);outcome=nil;destination=nil;lock.unlock()
  continuation?.resume(with:result)
 }
 func urlSession(_ session:URLSession,downloadTask:URLSessionDownloadTask,didWriteData bytesWritten:Int64,totalBytesWritten:Int64,totalBytesExpectedToWrite:Int64){
  if totalBytesWritten>maximum || totalBytesExpectedToWrite>maximum {downloadTask.cancel();return}
  if Date().timeIntervalSince(last)>=0.25 {last=Date();progress(min(0.99,Double(totalBytesWritten)/Double(maximum)))}
 }
 func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){
  if let mirrorHost,response.url?.host==mirrorHost,response.url?.path=="/api/download" {completionHandler(nil);return}
  guard let url=request.url,url.scheme=="https",let host=url.host,url.user==nil,url.password==nil,
        url.port==nil || url.port==443,
        ["api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"].contains(host) || host==mirrorHost
  else{completionHandler(nil);return}
  var safe=request;if host != "api.github.com" {safe.setValue(nil,forHTTPHeaderField:"Authorization")};completionHandler(safe)
 }
}
