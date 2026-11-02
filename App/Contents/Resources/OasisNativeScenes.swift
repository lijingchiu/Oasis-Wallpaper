import Cocoa
import WebKit
import Metal
import QuartzCore
import CryptoKit
import Security

private final class OasisSceneSurface:NSView {
 override func makeBackingLayer()->CALayer {CAMetalLayer()}
 override func hitTest(_ point:NSPoint)->NSView? {nil}
}

/// Metal scenes sit below the existing WebKit UI. No player, system media
/// controller, browser credential store or wallpaper shortcut adapter is linked.
@MainActor
final class OasisNativeScenes {
 typealias New=@convention(c)(UnsafeMutablePointer<UnsafeMutableRawPointer?>?)->Int32
 typealias Simple=@convention(c)(UnsafeMutableRawPointer?)->Int32
 typealias Surface=@convention(c)(UnsafeMutableRawPointer?,UnsafeMutableRawPointer?,UInt32,UInt32,UInt32,UInt32,Double)->Int32
 typealias Config=@convention(c)(UnsafeMutableRawPointer?,UnsafePointer<CChar>?,UnsafePointer<CChar>?,UnsafePointer<CChar>?,UInt32,Bool,Float,Bool,Bool,UnsafePointer<CChar>?)->Int32
 typealias Probe=@convention(c)(UnsafePointer<CChar>?,UnsafePointer<CChar>?,UnsafePointer<CChar>?,UnsafePointer<CChar>?,UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?)->Int32
 typealias Free=@convention(c)(UnsafeMutablePointer<CChar>?)->Void
 typealias Mouse=@convention(c)(UnsafeMutableRawPointer?,Double,Double)->Int32
 typealias Button=@convention(c)(UnsafeMutableRawPointer?,Int32,Bool)->Int32
 typealias Pause=@convention(c)(UnsafeMutableRawPointer?,Bool)->Int32
 typealias Volume=@convention(c)(UnsafeMutableRawPointer?,Float)->Int32
 typealias SetInt=@convention(c)(UnsafeMutableRawPointer?,UnsafePointer<CChar>?,Int32)->Int32
 typealias Callback=@convention(c)(UnsafeMutableRawPointer?)->Void
 typealias Subscribe=@convention(c)(UnsafeMutableRawPointer?,Callback?,UnsafeMutableRawPointer?,Callback?)->Int32
 private final class Box:@unchecked Sendable {weak var owner:OasisNativeScenes?;weak var view:WKWebView?;let id:String,attempt:UUID;init(_ owner:OasisNativeScenes,_ view:WKWebView,_ id:String,_ attempt:UUID){self.owner=owner;self.view=view;self.id=id;self.attempt=attempt}}
 private final class Instance {
  let attempt=UUID();let id:String,view:OasisSceneSurface,handle:UnsafeMutableRawPointer,revision:Int,configurationKey:String
  var width=0,height=0,ready=false,fps=0,preflightOnly=false
  init(id:String,view:OasisSceneSurface,handle:UnsafeMutableRawPointer,revision:Int,configurationKey:String){self.id=id;self.view=view;self.handle=handle;self.revision=revision;self.configurationKey=configurationKey}
 }
 private let resources:URL,port:Int,token:String,views:()->[(WKWebView,Bool,Bool)],compactHeight:()->CGFloat,desktopScreen:String?,audioAllowed:()->Bool,shouldPause:()->Bool
 private var timer:Timer?,library:UnsafeMutableRawPointer?,instances:[ObjectIdentifier:Instance]=[:],retired:[Instance]=[],rejectedConfigurations:[ObjectIdentifier:String]=[:],busy=false,reported=Set<String>(),request:[String:Any]?
 private var probe:Probe?,free:Free?,mouse:Mouse?,button:Button?,enter:Pause?,audioMute:Pause?,audioVolume:Volume?,setInt:SetInt?,probed=Set<String>(),failedIDs=Set<String>()
 private var backendFailure:Simple?
 private var create:New?,initialize:Simple?,destroy:Simple?,initSurface:Surface?,beginResize:Simple?,finishResize:Surface?,configure:Config?,pause:Pause?,firstFrame:Subscribe?,renderFailure:Subscribe?
 init(resources:URL,port:Int,token:String,views:@escaping()->[(WKWebView,Bool,Bool)],compactHeight:@escaping()->CGFloat,desktopScreen:String?=nil,audioAllowed:@escaping()->Bool={true},shouldPause:@escaping()->Bool={false}){self.resources=resources;self.port=port;self.token=token;self.views=views;self.compactHeight=compactHeight;self.desktopScreen=desktopScreen;self.audioAllowed=audioAllowed;self.shouldPause=shouldPause}
 static func verifiedRenderer(resources:URL)->URL? {
  let binary=resources.appendingPathComponent("SceneRenderer/libOasisSceneRenderer.dylib")
  // Local signing has no Apple Team ID. Check the digest compiled into the host and the library
  // signature before loading this one bundled renderer; user packages are data.
  guard let info=try? binary.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey]),info.isRegularFile==true,info.isSymbolicLink != true,
        let bytes=try? Data(contentsOf:binary,options:.mappedIfSafe),
        SHA256.hash(data:bytes).map({String(format:"%02x",$0)}).joined()==OasisSceneRendererIdentity.sha256 else{return nil}
  var signed:SecStaticCode?
  guard SecStaticCodeCreateWithPath(binary as CFURL,[],&signed)==errSecSuccess,let signed,
        SecStaticCodeCheckValidity(signed,SecCSFlags(rawValue:kSecCSStrictValidate|kSecCSCheckAllArchitectures),nil)==errSecSuccess else{return nil}
  return binary

 }
 private func load()->Bool {
  if library != nil{return true}
  guard #available(macOS 15.0,*),let binary=Self.verifiedRenderer(resources:resources),let loaded=dlopen(binary.path,RTLD_NOW|RTLD_LOCAL) else{return false}
  func symbol<T>(_ name:String,_ type:T.Type)->T? {guard let value=dlsym(loaded,name) else{return nil};return unsafeBitCast(value,to:type)}
  backendFailure=symbol("owe_scene_wallpaper_backend_failure",Simple.self);probe=symbol("owe_scene_capability_probe",Probe.self);free=symbol("owe_free_string",Free.self);mouse=symbol("owe_scene_wallpaper_mouse_input",Mouse.self);button=symbol("owe_scene_wallpaper_mouse_button",Button.self);enter=symbol("owe_scene_wallpaper_mouse_enter",Pause.self)
  create=symbol("owe_scene_wallpaper_new",New.self);initialize=symbol("owe_scene_wallpaper_init",Simple.self);destroy=symbol("owe_scene_wallpaper_delete",Simple.self)
  initSurface=symbol("owe_scene_wallpaper_init_metal",Surface.self);beginResize=symbol("owe_scene_wallpaper_begin_surface_reconfigure",Simple.self);finishResize=symbol("owe_scene_wallpaper_finish_surface_reconfigure",Surface.self)
  configure=symbol("owe_scene_wallpaper_apply_config",Config.self);pause=symbol("owe_scene_wallpaper_set_paused",Pause.self)
  audioMute=symbol("owe_scene_wallpaper_set_audio_muted",Pause.self);audioVolume=symbol("owe_scene_wallpaper_set_audio_volume",Volume.self)
  setInt=symbol("owe_scene_wallpaper_set_property_int32",SetInt.self)
  firstFrame=symbol("owe_scene_wallpaper_set_first_frame_callback",Subscribe.self);renderFailure=symbol("owe_scene_wallpaper_set_render_failure_callback",Subscribe.self)
  guard backendFailure != nil,create != nil,initialize != nil,destroy != nil,initSurface != nil,configure != nil,pause != nil,firstFrame != nil,renderFailure != nil else{dlclose(loaded);return false}
  library=loaded;return true
 }
 func start(){stop();timer=Timer.scheduledTimer(withTimeInterval:1,repeats:true){[weak self] _ in Task{await self?.poll()}};Task{await poll()}}
 func stop(){timer?.invalidate();timer=nil;for value in Array(instances.values)+retired{release(value)};instances.removeAll();retired.removeAll();rejectedConfigurations.removeAll();request=nil;reported.removeAll();probed.removeAll();failedIDs.removeAll()}
 private func release(_ value:Instance){value.view.removeFromSuperview();let delete=destroy,address=UInt(bitPattern:value.handle);DispatchQueue.global(qos:.utility).async{_ = delete?(UnsafeMutableRawPointer(bitPattern:address))}}
 private func native(_ body:[String:Any]) async->[String:Any]? {
  var payload=body;if let desktopScreen{payload["desktopHost"]=true;payload["screen"]=desktopScreen}
  var r=URLRequest(url:URL(string:"http://127.0.0.1:\(port)/api/native-scene")!);r.httpMethod="POST";r.timeoutInterval=5;r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.setValue(token,forHTTPHeaderField:"X-Mole-Native");r.httpBody=try? JSONSerialization.data(withJSONObject:payload)
  guard let (data,response)=try? await URLSession.shared.data(for:r),let http=response as? HTTPURLResponse,http.statusCode==200,data.count<2097152 else{return nil}
  return try? JSONSerialization.jsonObject(with:data) as? [String:Any]
 }
 private func poll() async {
  guard !busy else{return};busy=true;defer{busy=false}
  guard let value=await native([:]) else{return};let next=value["scene"] as? [String:Any]
  if next?["id"] as? String != request?["id"] as? String || next?["revision"] as? Int != request?["revision"] as? Int {reported.removeAll();probed.removeAll();failedIDs.removeAll();if next?["id"] as? String == request?["id"] as? String,next?["id"] as? String != nil {for value in Array(instances.values)+retired{release(value)};instances.removeAll();retired.removeAll()}}
  request=next
  guard let selected=request,let id=selected["id"] as? String,selected["enabled"] as? Bool != false else{for value in Array(instances.values)+retired{release(value)};instances.removeAll();retired.removeAll();return}
  guard !failedIDs.contains(id) else{return}
  guard load() else {if reported.insert(id+":unavailable").inserted{_ = await native(["id":id,"state":"error","reason":"renderer-unavailable","revision":selected["revision"] as? Int ?? 0])};return}
  if !probed.contains(id),let probe,let free,let source=selected["source"] as? String,let assets=selected["assets"] as? String,let cache=selected["cache"] as? String {
   let result=await Task.detached(priority:.utility){()->String? in
    var value:UnsafeMutablePointer<CChar>?;let code=source.withCString{s in assets.withCString{a in cache.withCString{c in probe(s,a,c,nil,&value)}}};defer{free(value)}
    guard code==0,let value,let data=String(cString:value).data(using:.utf8),let object=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else{return "Scene validation failed"}
    if let error=object["read_error"] as? String,!error.isEmpty{return String(error.prefix(600))}
    if let stage=object["failure_stage"] as? String,!stage.isEmpty{return String((object["failure_reason"] as? String ?? stage).prefix(600))}
    return nil
   }.value
   probed.insert(id);if let result{failedIDs.insert(id);_ = await native(["id":id,"state":"error","reason":result,"revision":selected["revision"] as? Int ?? 0]);return}
  }
  let surfaces=views(),desktop=value["desktop"] as? [String:Any] ?? [:],appYields=desktopScreen==nil && (value["desktopAudioActive"] as? Bool ?? (desktop["enabled"] as? Bool == true && desktop["audio"] as? Bool == true))
  func surface(_ compact:Bool)->[String:Any] {var result=selected;if compact,let menu=selected["menu"] as? [String:Any]{result.merge(menu){_,new in new}};return result}
  func wantsAudio(_ compact:Bool)->Bool {let display=surface(compact)["display"] as? [String:Any] ?? [:];return display["audio"] as? Bool == true && ((display["volume"] as? NSNumber)?.doubleValue ?? 50)>0}
  let owner=audioAllowed() && !shouldPause() && !appYields ? (surfaces.first(where:{$0.1 && !$0.2 && wantsAudio(false)})?.0 ?? surfaces.first(where:{$0.1 && wantsAudio($0.2)})?.0):nil
  for (web,_,_) in surfaces where web !== owner {if let item=instances[ObjectIdentifier(web)]{_=audioMute?(item.handle,true)}}
  for (web,visible,compact) in surfaces{
   let key=ObjectIdentifier(web),scoped=surface(compact),configuration=Self.configurationKey(scoped)
   if let old=instances[key],old.id==id,old.configurationKey==configuration {rejectedConfigurations.removeValue(forKey:key)}
   if let old=instances[key],old.id != id || old.configurationKey != configuration && rejectedConfigurations[key] != configuration {instances.removeValue(forKey:key);if old.id != id{rejectedConfigurations.removeValue(forKey:key)};if old.preflightOnly{release(old)}else{if selected["preflightOnly"] as? Bool != true {_=audioMute?(old.handle,true)};retired.append(old)}}
   if instances[key]==nil,let index=retired.firstIndex(where:{$0.id==id && $0.configurationKey==configuration && $0.view.superview===web.superview && $0.ready}){instances[key]=retired.remove(at:index)}
   if instances[key]==nil&&visible {createInstance(web,scoped,compact:compact)}
   guard let instance=instances[key] else{continue}
   if (backendFailure?(instance.handle) ?? 0)>0 {await failed(Box(self,web,id,instance.attempt));continue}
   let reduced=NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
   _=pause?(instance.handle,!visible||(shouldPause()||reduced)&&instance.ready)
   let fps=max(5,min(144,selected["fps"] as? Int ?? 30));if instance.fps != fps {instance.fps=fps;_="fps".withCString{setInt?(instance.handle,$0,Int32(fps))}}
   if visible {resize(instance,web: web,compact:compact);OasisWallpaperPresentation.apply(instance.view,scoped["display"] as? [String:Any])}
   instance.view.alphaValue=instance.ready && selected["preflightOnly"] as? Bool != true ? CGFloat(selected["intensity"] as? Double ?? 0.45):0
   let display=scoped["display"] as? [String:Any] ?? [:],volume=max(0,min(1,((display["volume"] as? NSNumber)?.floatValue ?? 50)/100))
   _=audioVolume?(instance.handle,volume);_=audioMute?(instance.handle,web !== owner || !visible || shouldPause() || display["audio"] as? Bool != true || selected["preparing"] as? Bool == true)
  }
 }
 private func dimensions(_ web:WKWebView,_ compact:Bool)->(Int,Int,Int,Int,Double){
  let width=max(1,Int(web.bounds.width)),height=max(1,Int(compact ? max(web.bounds.height,compactHeight()):web.bounds.height)),scale=web.window?.backingScaleFactor ?? 2
  let factor=min(scale,1920/Double(width));return(width,height,max(1,Int(Double(width)*factor)),max(1,Int(Double(height)*factor)),scale)
 }
 private func resize(_ instance:Instance,web:WKWebView,compact:Bool){
  let (width,height,rw,rh,scale)=dimensions(web,compact)
  instance.view.frame=NSRect(x:0,y:web.bounds.height-CGFloat(height),width:CGFloat(width),height:CGFloat(height))
  guard let layer=instance.view.layer as? CAMetalLayer else{return};layer.contentsScale=scale;layer.drawableSize=CGSize(width:rw,height:rh)
  if instance.width != rw || instance.height != rh {
   if instance.width>0 {_=beginResize?(instance.handle)}
   let pointer=Unmanaged.passUnretained(layer).toOpaque()
   if instance.width>0 {_=finishResize?(instance.handle,pointer,UInt32(width),UInt32(height),UInt32(rw),UInt32(rh),scale)}
   else {_=initSurface?(instance.handle,pointer,UInt32(width),UInt32(height),UInt32(rw),UInt32(rh),scale)}
   instance.width=rw;instance.height=rh
  }
 }
 private static func configurationKey(_ data:[String:Any])->String {let display=data["display"] as? [String:Any] ?? [:],properties=display["properties"] as? [String:Any] ?? [:];return (try? JSONSerialization.data(withJSONObject:properties,options:.sortedKeys)).flatMap{String(data:$0,encoding:.utf8)} ?? "{}"}
 private func createInstance(_ web:WKWebView,_ data:[String:Any],compact:Bool){
  guard let root=web.superview,let id=data["id"] as? String,let source=data["source"] as? String,let assets=data["assets"] as? String,let cache=data["cache"] as? String,let device=MTLCreateSystemDefaultDevice() else{return}
  var pointer:UnsafeMutableRawPointer?;guard create?(&pointer)==0,let handle=pointer else{return};guard initialize?(handle)==0 else{_=destroy?(handle);return}
  let surface=OasisSceneSurface(frame:web.frame);surface.wantsLayer=true;surface.alphaValue=0;surface.autoresizingMask=[.width,.height]
  guard let layer=surface.layer as? CAMetalLayer else{_=destroy?(handle);return};layer.device=device;layer.pixelFormat = .bgra8Unorm;layer.framebufferOnly=false;layer.isOpaque=false
  root.addSubview(surface,positioned:.below,relativeTo:web)
  let instance=Instance(id:id,view:surface,handle:handle,revision:data["revision"] as? Int ?? 0,configurationKey:Self.configurationKey(data));instance.preflightOnly=data["preflightOnly"] as? Bool == true;instances[ObjectIdentifier(web)]=instance;resize(instance,web:web,compact:compact)
  let readyBox=Unmanaged.passRetained(Box(self,web,id,instance.attempt)).toOpaque(),failureBox=Unmanaged.passRetained(Box(self,web,id,instance.attempt)).toOpaque()
  let drop:Callback={pointer in if let pointer{Unmanaged<Box>.fromOpaque(pointer).release()}}
  let ready:Callback={pointer in guard let pointer else{return};let box=Unmanaged<Box>.fromOpaque(pointer).takeUnretainedValue();Task{@MainActor in await box.owner?.ready(box)}}
  let failure:Callback={pointer in guard let pointer else{return};let box=Unmanaged<Box>.fromOpaque(pointer).takeUnretainedValue();Task{@MainActor in await box.owner?.failed(box)}}
  if firstFrame?(handle,ready,readyBox,drop) != 0 {Unmanaged<Box>.fromOpaque(readyBox).release()}
  if renderFailure?(handle,failure,failureBox,drop) != 0 {Unmanaged<Box>.fromOpaque(failureBox).release()}
  try? FileManager.default.createDirectory(atPath:cache,withIntermediateDirectories:true)
  let display=data["display"] as? [String:Any] ?? [:],properties=display["properties"] as? [String:Any] ?? [:]
  let overrides=(try? JSONSerialization.data(withJSONObject:properties,options:.sortedKeys)).flatMap{String(data:$0,encoding:.utf8)} ?? "{}"
  let fps=UInt32(max(5,min(144,data["fps"] as? Int ?? 30)))
  let status=source.withCString {s in assets.withCString {a in cache.withCString {c in overrides.withCString {p in configure?(handle,s,a,c,fps,false,0,true,false,p)}}}}
  if status != 0 {Task{await failed(Box(self,web,id,instance.attempt))}}
 }
 private func ready(_ box:Box) async {
  guard let web=box.view,let instance=instances[ObjectIdentifier(web)],instance.id==box.id,instance.attempt==box.attempt else{return};if (backendFailure?(instance.handle) ?? 0)>0 {await failed(box);return};instance.ready=true;instance.view.alphaValue=instance.preflightOnly ? 0:CGFloat(request?["intensity"] as? Double ?? 0.45)
  if !instance.preflightOnly {for old in retired where old.view.superview===instance.view.superview{release(old)};retired.removeAll(where:{$0.view.superview==nil});publish(web,id:box.id,ready:true)}
  if reported.insert(box.id+":ready").inserted {_=await native(["id":box.id,"state":"ready"])}
 }
 private func failed(_ box:Box) async {
  guard let web=box.view,let instance=instances[ObjectIdentifier(web)],instance.id==box.id,instance.attempt==box.attempt else{return};let key=ObjectIdentifier(web)
  if let index=retired.lastIndex(where:{$0.id==instance.id && $0.view.superview===web.superview && $0.ready}) {rejectedConfigurations[key]=instance.configurationKey;instances.removeValue(forKey:key);release(instance);let previous=retired.remove(at:index);instances[key]=previous;publish(web,id:previous.id,ready:true);return}
  publish(web,id:box.id,ready:false);failedIDs.insert(box.id);instances.removeValue(forKey:key);release(instance)
  if reported.insert(box.id+":error").inserted {_=await native(["id":box.id,"state":"error","reason":"scene-render-failed","revision":instance.revision])}
 }
 func pointer(_ web:WKWebView,value:[String:Any]){guard let item=instances[ObjectIdentifier(web)],item.ready,let x=value["x"] as? Double,let y=value["y"] as? Double,x.isFinite,y.isFinite,value["kind"] as? String == "move" else{return};_=enter?(item.handle,true);_=mouse?(item.handle,max(0,min(1,x)),max(0,min(1,y)))}
 func replay(_ web:WKWebView,id:String){guard let item=instances[ObjectIdentifier(web)],item.id==id,item.ready else{return};publish(web,id:id,ready:true)}
 private func publish(_ web:WKWebView,id:String,ready:Bool){
  guard let data=try? JSONSerialization.data(withJSONObject:["id":id,"ready":ready]),let json=String(data:data,encoding:.utf8) else{return}
  web.evaluateJavaScript("window.oasisNativeSceneState?.(\(json));window.OasisWeather?.refresh();",completionHandler:nil)
 }
}
