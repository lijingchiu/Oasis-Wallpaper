import Cocoa
import WebKit
import CoreGraphics
import CoreAudio
import IOKit.ps
import ApplicationServices

/// A wallpaper is a click-through window between the system picture and the
/// Finder icon layer. The user's configured macOS wallpaper is never changed.
@MainActor
final class OasisDesktopWallpapers {
 @MainActor private final class Session {
  let id:String,display:CGDirectDisplayID,window:NSWindow,anchor:WKWebView,bridge:Bridge
  var scenes:OasisNativeScenes!,web:OasisNativeWebWallpapers!,paused=false,audible=false
  init(id:String,display:CGDirectDisplayID,window:NSWindow,anchor:WKWebView,bridge:Bridge){self.id=id;self.display=display;self.window=window;self.anchor=anchor;self.bridge=bridge}
  func close(){scenes?.stop();web?.stop();anchor.configuration.userContentController.removeScriptMessageHandler(forName:"mole");anchor.stopLoading();window.orderOut(nil);window.close()}
 }
 @MainActor private final class Bridge:NSObject,WKScriptMessageHandler,WKNavigationDelegate {
  weak var session:Session?
  let port:Int
  init(port:Int){self.port=port}
  func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){
   guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="127.0.0.1",message.frameInfo.securityOrigin.port==port,let body=message.body as? [String:Any],let action=body["action"] as? String,let session else{return}
   if action=="wallpaperOrigin",let value=body["url"] as? String,let url=URL(string:value){session.web.register(url)}
   if action=="wallpaperReplay",let id=body["id"] as? String {session.web.replay(session.anchor,id:id);session.scenes.replay(session.anchor,id:id)}
  }
  func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){let url=navigationAction.request.url;decisionHandler(url?.scheme=="about" || url?.host=="127.0.0.1" && url?.port==port ? .allow:.cancel)}
 }
 private struct Screen {let id:String,name:String,display:CGDirectDisplayID,frame:NSRect}
 private let resources:URL,port:Int,token:String,publish:([[String:Any]])->Void
 private var timer:Timer?,pointerTimer:Timer?,mouseMonitor:Any?,mouseSession:String?,sessions:[String:Session]=[:],observers:[(NotificationCenter,NSObjectProtocol)]=[],busy=false,screensSleeping=false,lastScreens="",config:[String:Any]=[:],lastPointer:NSPoint?,ownershipBlocked=false
 private let ownership=OasisDesktopOwnership()
 init(resources:URL,port:Int,token:String,publish:@escaping([[String:Any]])->Void){self.resources=resources;self.port=port;self.token=token;self.publish=publish}
 func start(){stop();observe();publishScreens();timer=Timer.scheduledTimer(withTimeInterval:2,repeats:true){[weak self] _ in Task{@MainActor in await self?.poll()}};Task{await poll()}}
 func stop(){timer?.invalidate();timer=nil;pointerTimer?.invalidate();pointerTimer=nil;removeMouseMonitor();for (center,observer) in observers{center.removeObserver(observer)};observers=[];closeSessions();ownership.release();config=[:];lastScreens="";lastPointer=nil;ownershipBlocked=false}
 private func closeSessions(){removeMouseMonitor();for session in sessions.values{session.close()};sessions.removeAll();pointerTimer?.invalidate();pointerTimer=nil}
 // Versions of Oasis built before the shared ownership lock cannot claim it.
 // Avoid covering their desktop until the user disables their wallpaper.
 private func legacyOasisMayOwnDesktop()->Bool {
  guard Bundle.main.bundleIdentifier=="local.oasis.wallpaper",!ownership.held,!NSRunningApplication.runningApplications(withBundleIdentifier:"local.mole.dashboard").isEmpty else{return false}
  let path=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/mole/oasis-weather.json")
  guard let data=try? Data(contentsOf:path),data.count<4_000_000,let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let settings=object["settings"] as? [String:Any],let desktop=settings["desktop"] as? [String:Any] else{return false}
  return desktop["enabled"] as? Bool == true
 }
 func diagnostics()->[[String:Any]] {sessions.values.map{["screen":$0.id,"window":$0.window.windowNumber,"level":$0.window.level.rawValue,"clickThrough":$0.window.ignoresMouseEvents,"paused":$0.paused,"audible":$0.audible]}}
 func verificationViews()->[WKWebView] {sessions.values.map{$0.anchor}}
 private func observe(){
  let app=NotificationCenter.default,workspace=NSWorkspace.shared.notificationCenter
  observers.append((app,app.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main){[weak self] _ in Task{@MainActor in self?.publishScreens();await self?.poll()}}))
  for name in [NSWorkspace.screensDidSleepNotification,NSWorkspace.willSleepNotification]{observers.append((workspace,workspace.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in Task{@MainActor in self?.screensSleeping=true;await self?.poll()}}))}
  for name in [NSWorkspace.screensDidWakeNotification,NSWorkspace.didWakeNotification]{observers.append((workspace,workspace.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in Task{@MainActor in self?.screensSleeping=false;await self?.poll()}}))}
 }
 private func screens()->[Screen] {NSScreen.screens.compactMap{screen in guard let value=screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else{return nil};let id=CGDirectDisplayID(value.uint32Value),uuid=CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue(),name=uuid.map{CFUUIDCreateString(nil,$0) as String} ?? String(id);return Screen(id:name,name:screen.localizedName,display:id,frame:screen.frame)}}
 func publishScreens(force:Bool=false){let trusted=AXIsProcessTrusted(),rows=screens().enumerated().map{index,screen in ["id":screen.id,"name":screen.name,"primary":index==0,"width":Int(screen.frame.width),"height":Int(screen.frame.height),"desktopInputTrusted":trusted,"desktopOwnershipBlocked":ownershipBlocked] as [String:Any]};guard let data=try? JSONSerialization.data(withJSONObject:rows,options:.sortedKeys),let key=String(data:data,encoding:.utf8) else{return};if force || key != lastScreens{lastScreens=key;publish(rows)}}
 func requestInputAccess(){_ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary);publishScreens(force:true)}
 private func request() async->[String:Any]? {var r=URLRequest(url:URL(string:"http://127.0.0.1:\(port)/api/native-scene")!);r.httpMethod="POST";r.timeoutInterval=5;r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.setValue(token,forHTTPHeaderField:"X-Mole-Native");r.httpBody=try? JSONSerialization.data(withJSONObject:["desktopManagement":true,"desktopScreens":screens().map(\.id)]);guard let (data,response)=try? await URLSession.shared.data(for:r),(response as? HTTPURLResponse)?.statusCode==200 else{return nil};return (try? JSONSerialization.jsonObject(with:data)) as? [String:Any]}
 private func poll() async {
  guard !busy else{return};busy=true;defer{busy=false};guard let data=await request(),let desktop=data["desktop"] as? [String:Any] else{return};config=desktop;publishScreens()
  guard desktop["enabled"] as? Bool == true else{closeSessions();ownership.release();ownershipBlocked=false;publishScreens();return}
  guard !legacyOasisMayOwnDesktop(),ownership.claim() else{closeSessions();ownership.release();ownershipBlocked=true;publishScreens();return};ownershipBlocked=false;publishScreens()
  let screens=screens(),choices=desktop["screens"] as? [String:String] ?? [:],battery=Self.onBattery(),front=NSWorkspace.shared.frontmostApplication,other=front?.bundleIdentifier.map{!["com.apple.finder","com.apple.dock","local.mole.dashboard","local.oasis.wallpaper"].contains($0)} ?? false,windows=Self.frontWindows(front?.processIdentifier),muteOther=desktop["otherAudio"] as? String == "mute" && Self.otherAudioPlaying()
  var desired:[(Screen,String)]=[]
  for screen in screens {guard choices[screen.id] != "off" else{continue};let coverage=Self.coverage(screen.display,windows),action=Self.action(desktop,battery:battery,asleep:screensSleeping,focused:other,maximized:coverage==1,fullscreen:coverage==2);if action != "stop"{desired.append((screen,action))}}
  let ids=Set(desired.map{$0.0.id});for (id,session) in Array(sessions) where !ids.contains(id){session.close();sessions.removeValue(forKey:id)}
  let eligible=data["desktopAudibleScreens"] as? [String],audioID=Self.audioScreen(desired.map{($0.0.id,$0.1)},eligible:eligible)
  for (screen,action) in desired {
   if sessions[screen.id]==nil {sessions[screen.id]=makeSession(screen)}
   guard let session=sessions[screen.id] else{continue};if session.window.frame != screen.frame {session.window.setFrame(screen.frame,display:true)}
   let paused=action=="pause";session.paused=paused;session.anchor.evaluateJavaScript("window.oasisDesktopSetPaused?.(\(paused ? "true":"false"));",completionHandler:nil)
   session.audible=screen.id==audioID && !muteOther && !paused
  }
  if sessions.isEmpty {pointerTimer?.invalidate();pointerTimer=nil}
  else if pointerTimer==nil {pointerTimer=Timer.scheduledTimer(withTimeInterval:1.0/30,repeats:true){[weak self] _ in Task{@MainActor in self?.pointer()}}}
  updateMouseMonitor()
 }
 private func makeSession(_ screen:Screen)->Session {
  let window=NSWindow(contentRect:screen.frame,styleMask:.borderless,backing:.buffered,defer:false);window.title="Oasis Desktop Wallpaper";window.isReleasedWhenClosed=false;window.isOpaque=false;window.backgroundColor = .clear;window.hasShadow=false;window.ignoresMouseEvents=true;window.hidesOnDeactivate=false;window.level=NSWindow.Level(rawValue:Int(CGWindowLevelForKey(.desktopIconWindow))-1);window.collectionBehavior=[.canJoinAllSpaces,.stationary,.ignoresCycle,.fullScreenAuxiliary]
  let root=NSView(frame:NSRect(origin:.zero,size:screen.frame.size));root.wantsLayer=true;window.contentView=root
  let bridge=Bridge(port:port),config=WKWebViewConfiguration();config.mediaTypesRequiringUserActionForPlayback=[];config.userContentController.add(bridge,name:"mole");let encoded=(try? JSONSerialization.data(withJSONObject:screen.id,options:.fragmentsAllowed)).flatMap{String(data:$0,encoding:.utf8)} ?? "\"\"";config.userContentController.addUserScript(WKUserScript(source:"window.oasisDesktopScreen=\(encoded);",injectionTime:.atDocumentStart,forMainFrameOnly:true))
  let anchor=WKWebView(frame:root.bounds,configuration:config);anchor.autoresizingMask=[.width,.height];anchor.setValue(false,forKey:"drawsBackground");anchor.underPageBackgroundColor = .clear;anchor.navigationDelegate=bridge;root.addSubview(anchor)
  let session=Session(id:screen.id,display:screen.display,window:window,anchor:anchor,bridge:bridge);bridge.session=session
  session.scenes=OasisNativeScenes(resources:resources,port:port,token:token,views:{[weak session] in guard let session else{return []};return [(session.anchor,true,false)]},compactHeight:{screen.frame.height},desktopScreen:screen.id,audioAllowed:{[weak session] in session?.audible == true},shouldPause:{[weak session] in session?.paused ?? true})
  session.web=OasisNativeWebWallpapers(port:port,token:token,views:{[weak session] in guard let session else{return []};return [(session.anchor,true,false)]},compactHeight:{screen.frame.height},desktopScreen:screen.id,audioAllowed:{[weak session] in session?.audible == true},shouldPause:{[weak session] in session?.paused ?? true})
  window.orderFrontRegardless();anchor.load(URLRequest(url:URL(string:"http://127.0.0.1:\(port)/desktop-wallpaper")!));session.scenes.start();session.web.start();return session
 }
 private func pointer(){guard !sessions.isEmpty else{return};let point=NSEvent.mouseLocation;if point==lastPointer{return};lastPointer=point;for session in sessions.values where !session.paused && session.window.frame.contains(point){let rect=session.window.frame,x=Double((point.x-rect.minX)/max(1,rect.width)),y=Double((rect.maxY-point.y)/max(1,rect.height)),value:[String:Any]=["kind":"move","x":x,"y":y];session.scenes.pointer(session.anchor,value:value);session.web.pointer(session.anchor,value:value);session.anchor.evaluateJavaScript("window.oasisDesktopPointer?.(\(x),\(y));",completionHandler:nil)}}
 private func removeMouseMonitor(){if let mouseMonitor{NSEvent.removeMonitor(mouseMonitor)};mouseMonitor=nil;mouseSession=nil}
 private func updateMouseMonitor(){
  let needed=AXIsProcessTrusted() && sessions.values.contains{!$0.paused && $0.web.acceptsDesktopMouse($0.anchor)}
  if !needed {removeMouseMonitor();return};guard mouseMonitor==nil else{return}
  mouseMonitor=NSEvent.addGlobalMonitorForEvents(matching:[.leftMouseDown,.leftMouseUp,.leftMouseDragged]){[weak self] event in Task{@MainActor in self?.desktopMouse(event)}}
 }
 private func desktopMouse(_ event:NSEvent){
  guard let quartz=event.cgEvent?.location,let primary=NSScreen.screens.first else{mouseSession=nil;return}
  let point=NSPoint(x:quartz.x,y:primary.frame.maxY-quartz.y)
  if event.type == .leftMouseDown {
   mouseSession=nil
   guard Self.isDesktopPoint(quartz),let session=sessions.values.first(where:{!$0.paused && $0.window.frame.contains(point) && $0.web.acceptsDesktopMouse($0.anchor)}) else{return}
   mouseSession=session.id;session.web.desktopMouse(session.anchor,event:event,screenPoint:point)
  }else if let id=mouseSession,let session=sessions[id],!session.paused {
   let valid=session.window.frame.contains(point) && (event.type == .leftMouseUp ? Self.isDesktopPoint(quartz):Self.desktopGroup(quartz) != nil)
   // Release outside the Web view if another window covered the desktop while
   // dragging, so an unrelated mouse-up can never activate a wallpaper button.
   if event.type == .leftMouseUp {session.web.desktopMouse(session.anchor,event:event,screenPoint:valid ? point:NSPoint(x:session.window.frame.minX-1000,y:session.window.frame.minY-1000));mouseSession=nil}
   else if valid {session.web.desktopMouse(session.anchor,event:event,screenPoint:point)}
  }else if event.type == .leftMouseUp {mouseSession=nil}
 }
 private static func unobstructed(_ point:CGPoint)->Bool {
  guard let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else{return false}
  let dockPID=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.dock").first?.processIdentifier,displays=NSScreen.screens.compactMap{screen -> CGRect? in guard let number=screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else{return nil};return CGDisplayBounds(CGDirectDisplayID(number.uint32Value))}
  for row in windows {
   guard let level=(row[kCGWindowLayer as String] as? NSNumber)?.intValue,level>=0,((row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1)>0,let bounds=row[kCGWindowBounds as String] as? [String:Any],let rect=CGRect(dictionaryRepresentation:bounds as CFDictionary),rect.contains(point) else{continue}
   let owner=(row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
   if isFullDisplayDockWindow(owner:owner,level:level,bounds:rect,dockPID:dockPID,displays:displays){continue}
   return false
  }
  return true
 }
 // Dock can own a full-display, mostly transparent window. Its actual controls
 // are still protected by the Finder accessibility hit test below.
 static func isFullDisplayDockWindow(owner:pid_t?,level:Int,bounds:CGRect,dockPID:pid_t?,displays:[CGRect])->Bool {
  guard let owner,let dockPID,owner==dockPID,level==Int(CGWindowLevelForKey(.dockWindow)) else{return false}
  return displays.contains{abs($0.minX-bounds.minX)<1 && abs($0.minY-bounds.minY)<1 && abs($0.width-bounds.width)<1 && abs($0.height-bounds.height)<1}
 }
 private static func attribute(_ element:AXUIElement,_ name:CFString)->CFTypeRef? {var value:CFTypeRef?;return AXUIElementCopyAttributeValue(element,name,&value) == .success ? value:nil}
 private static func element(_ value:CFTypeRef?)->AXUIElement? {guard let value,CFGetTypeID(value)==AXUIElementGetTypeID() else{return nil};return (value as! AXUIElement)}
 private static func desktopGroup(_ point:CGPoint)->AXUIElement? {
  guard AXIsProcessTrusted(),unobstructed(point),let finder=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.finder").first else{return nil}
  var hit:AXUIElement?;guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(point.x),Float(point.y),&hit) == .success,let group=hit else{return nil}
  var pid:pid_t=0;guard AXUIElementGetPid(group,&pid) == .success,pid==finder.processIdentifier,
   attribute(group,kAXRoleAttribute as CFString) as? String == kAXGroupRole as String,
   let scroll=element(attribute(group,kAXParentAttribute as CFString)),attribute(scroll,kAXRoleAttribute as CFString) as? String == kAXScrollAreaRole as String,
   let owner=element(attribute(scroll,kAXParentAttribute as CFString)),attribute(owner,kAXRoleAttribute as CFString) as? String == kAXApplicationRole as String else{return nil}
  return group
 }
 static func isDesktopPoint(_ point:CGPoint)->Bool {
  guard let group=desktopGroup(point),let icons=attribute(group,kAXChildrenAttribute as CFString) as? [AXUIElement] else{return false}
  for icon in icons {
   guard let p=attribute(icon,kAXPositionAttribute as CFString),let s=attribute(icon,kAXSizeAttribute as CFString),CFGetTypeID(p)==AXValueGetTypeID(),CFGetTypeID(s)==AXValueGetTypeID() else{return false}
   var origin=CGPoint.zero,size=CGSize.zero;guard AXValueGetValue(p as! AXValue,.cgPoint,&origin),AXValueGetValue(s as! AXValue,.cgSize,&size) else{return false}
   // Finder's caption extends beyond the image's accessibility frame.
   if CGRect(origin:origin,size:size).insetBy(dx:-24,dy:-36).contains(point){return false}
  }
  return true
 }
 static func action(_ config:[String:Any],battery:Bool,asleep:Bool,focused:Bool,maximized:Bool,fullscreen:Bool)->String {
  let rank=["play":0,"pause":1,"stop":2];var result=config[battery ? "battery":"ac"] as? String ?? "play"
  func merge(_ key:String,_ active:Bool){guard active else{return};let value=config[key] as? String ?? "play";if (rank[value] ?? 0)>(rank[result] ?? 0){result=value}}
  merge("sleep",asleep);merge("focused",focused);merge("maximized",maximized);merge("fullscreen",fullscreen);return rank[result] == nil ? "play":result
 }
 static func audioScreen(_ displays:[(String,String)],eligible:[String]?)->String? {displays.first(where:{$0.1=="play" && (eligible?.contains($0.0) ?? true)})?.0}
 private static func onBattery()->Bool {guard let source=IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),let type=IOPSGetProvidingPowerSourceType(source)?.takeUnretainedValue() else{return false};return (type as String)==kIOPSBatteryPowerValue}
 private static func frontWindows(_ pid:pid_t?)->[CGRect] {guard let pid,let list=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else{return []};return list.compactMap{row in guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==pid,(row[kCGWindowLayer as String] as? NSNumber)?.intValue==0,((row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1)>0,let bounds=row[kCGWindowBounds as String] as? [String:Any] else{return nil};return CGRect(dictionaryRepresentation:bounds as CFDictionary)}}
 private static func coverage(_ display:CGDirectDisplayID,_ windows:[CGRect])->Int {let bounds=CGDisplayBounds(display);guard bounds.width>0,bounds.height>0 else{return 0};var result=0;for window in windows{let overlap=window.intersection(bounds);if overlap.isNull{continue};let w=overlap.width/bounds.width,h=overlap.height/bounds.height;if w>=0.985&&h>=0.985{return 2};if w>=0.9&&h>=0.86{result=1}};return result}
 private static func otherAudioPlaying()->Bool {
  guard #available(macOS 14.2,*) else{return false};var address=AudioObjectPropertyAddress(mSelector:kAudioHardwarePropertyProcessObjectList,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain),size:UInt32=0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject),&address,0,nil,&size)==noErr,size>0 else{return false};var objects=[AudioObjectID](repeating:0,count:Int(size)/MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),&address,0,nil,&size,&objects)==noErr else{return false}
  for object in objects {var pid:pid_t=0,running:UInt32=0,pidSize=UInt32(MemoryLayout<pid_t>.size),stateSize=UInt32(MemoryLayout<UInt32>.size),pidAddress=AudioObjectPropertyAddress(mSelector:kAudioProcessPropertyPID,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain),stateAddress=AudioObjectPropertyAddress(mSelector:kAudioProcessPropertyIsRunningOutput,mScope:kAudioObjectPropertyScopeGlobal,mElement:kAudioObjectPropertyElementMain)
   guard AudioObjectGetPropertyData(object,&pidAddress,0,nil,&pidSize,&pid)==noErr,pid != getpid(),AudioObjectGetPropertyData(object,&stateAddress,0,nil,&stateSize,&running)==noErr,running != 0 else{continue};let bundle=NSRunningApplication(processIdentifier:pid)?.bundleIdentifier ?? "";if bundle.hasPrefix("com.apple.WebKit") || ["local.mole.dashboard","local.oasis.wallpaper"].contains(bundle) {continue};return true
  };return false
 }
}
