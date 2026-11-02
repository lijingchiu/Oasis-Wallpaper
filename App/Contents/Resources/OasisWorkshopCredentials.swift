import Foundation
import Security

// Legacy macOS Keychain can ignore per-query UI flags while decrypting.
// Serialize this process's queries and disable interaction outside an explicit action.
enum OasisKeychainAccess {
 private static let lock=NSRecursiveLock()
 static func disableInteraction(){SecKeychainSetUserInteractionAllowed(false)}
 static func perform<T>(allowUI:Bool=false,_ operation:()throws->T)rethrows->T {
  lock.lock();defer{lock.unlock()}
  SecKeychainSetUserInteractionAllowed(allowUI)
  defer{SecKeychainSetUserInteractionAllowed(false)}
  return try operation()
 }
}

/// Steam refresh credentials travel only between Keychain, the native host and
/// the authenticated loopback endpoint. They never enter WebKit or preferences.
@MainActor
final class OasisWorkshopCredentials {
 private struct Credential:Codable,Sendable {let account:String;let token:String}
 private let port:Int,token:String
 private var timer:Timer?,busy=false,restored=false,authorizedAt:Date?
 private let service="local.oasis.steam-workshop"
 init(port:Int,token:String){self.port=port;self.token=token}
 private nonisolated static func query(_ service:String)->[String:Any]{[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"workshop",kSecUseAuthenticationUI as String:kSecUseAuthenticationUIFail]}
 private nonisolated static func load(_ service:String,allowUI:Bool=false)->(Credential?,OSStatus){
  OasisKeychainAccess.perform(allowUI:allowUI){
  var q=query(service);q[kSecReturnData as String]=true;if allowUI{q.removeValue(forKey:kSecUseAuthenticationUI as String)}
  var result:CFTypeRef?;let status=SecItemCopyMatching(q as CFDictionary,&result);guard status==errSecSuccess,let data=result as? Data else{return(nil,status)}
  guard let value=try? JSONDecoder().decode(Credential.self,from:data) else{return(nil,errSecDecode)};return(value,errSecSuccess)
  }
 }
 private nonisolated static func store(_ value:Credential?,service:String,allowUI:Bool=false)->Bool{
  OasisKeychainAccess.perform(allowUI:allowUI){
  var q=query(service);if allowUI{q.removeValue(forKey:kSecUseAuthenticationUI as String)}
  guard let value else{let status=SecItemDelete(q as CFDictionary);return status==errSecSuccess || status==errSecItemNotFound}
  guard let data=try? JSONEncoder().encode(value) else{return false}
  let update=SecItemUpdate(q as CFDictionary,[kSecValueData as String:data] as CFDictionary)
  if update==errSecSuccess{return true};if update != errSecItemNotFound{return false}
  var add=q;add.removeValue(forKey:kSecUseAuthenticationUI as String);add[kSecValueData as String]=data;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  return SecItemAdd(add as CFDictionary,nil)==errSecSuccess
  }
 }
 func start(){stop();restored=false;timer=Timer.scheduledTimer(withTimeInterval:2,repeats:true){[weak self] _ in Task{await self?.sync()}};Task{await sync()}}
 func stop(){timer?.invalidate();timer=nil}
 private func request(_ body:[String:Any]) async->[String:Any]?{
  guard let url=URL(string:"http://127.0.0.1:\(port)/api/native-workshop") else{return nil}
  var request=URLRequest(url:url);request.httpMethod="POST";request.timeoutInterval=4;request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.setValue(token,forHTTPHeaderField:"X-Mole-Native");request.httpBody=try? JSONSerialization.data(withJSONObject:body)
  guard let (data,response)=try? await URLSession.shared.data(for:request),let http=response as? HTTPURLResponse,http.statusCode==200,data.count<40000 else{return nil}
  return try? JSONSerialization.jsonObject(with:data) as? [String:Any]
 }
 // Interactive access is used only after the user chooses to download.
 func authorize() async->Bool {
  authorizedAt=Date();let service=service
  let (credential,status)=await Task.detached(priority:.userInitiated){Self.load(service,allowUI:true)}.value
  guard let credential else{_ = await request(["restoreStatus":Int(status)]);return false}
  let result=await request(["credentials":["account":credential.account,"token":credential.token],"restoreStatus":Int(status)])
  restored=result?["signedIn"] as? Bool==true;return restored
 }
 private func sync() async{
  guard !busy else{return};busy=true;defer{busy=false}
  var body:[String:Any]=[:]
  if !restored {
   let service=service
   let (value,status)=await Task.detached(priority:.utility,operation:{Self.load(service)}).value
   body["restoreStatus"]=Int(status);restored=true
   if let c=value {body["credentials"]=["account":c.account,"token":c.token]}
  }
  guard let result=await request(body) else{restored=false;return}
  guard let update=result["update"] as? [String:Any],let generation=update["generation"] as? String else{return}
  var value:Credential?
  if let data=update["credentials"] as? [String:Any],let account=data["account"] as? String,let token=data["token"] as? String,account.count<=128,token.count<=16000{value=Credential(account:account,token:token)}
  else if update["clear"] as? Bool != true{return}
  let selected=value,service=service,allowUI=authorizedAt.map{Date().timeIntervalSince($0)<1800} ?? false
  let saved=await Task.detached(priority:.utility){Self.store(selected,service:service,allowUI:allowUI)}.value
  _=await request(["storedGeneration":generation,"stored":saved])
 }
}
