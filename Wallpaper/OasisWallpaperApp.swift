import Cocoa
import WebKit

@MainActor
final class WallpaperApp:NSObject,NSApplicationDelegate,WKScriptMessageHandler,WKNavigationDelegate,WKUIDelegate {
 private var window:NSWindow!,view:WKWebView!,dragView:MoleWindowDragView!,mouseMonitor:Any?,backend:Process?,output:Pipe?,outputBuffer=Data(),port=0,shuttingDown=false,dragEnabled=true
 private var frostOverlay:NSVisualEffectView?
 private let token=UUID().uuidString+UUID().uuidString
 private var resources:URL {Bundle.main.resourceURL!}
 private lazy var scenes=OasisNativeScenes(resources:resources,port:port,token:token,views:{[weak self] in guard let self,let view=self.view else{return []};return [(view,true,false)]},compactHeight:{[weak self] in self?.window?.contentView?.bounds.height ?? 800})
 private lazy var webWallpapers=OasisNativeWebWallpapers(port:port,token:token,views:{[weak self] in guard let self,let view=self.view else{return []};return [(view,true,false)]},compactHeight:{[weak self] in self?.window?.contentView?.bounds.height ?? 800},audioAllowed:{false})
 private lazy var desktops=OasisDesktopWallpapers(resources:resources,port:port,token:token,publish:{[weak self] rows in self?.publish("window.oasisDesktopScreens",rows)})
 private lazy var workshop=OasisWorkshopCredentials(port:port,token:token)
 private lazy var location=OasisWeatherLocation()
 private let login=MoleLoginAtStartup()
 private lazy var updater = OasisWallpaperUpdater(reserveRestart: { [weak self] reserve in
  guard let self else { throw OasisUpdateError.install }
  try await self.reserveUpdateRestart(reserve)
 }, changed: { [weak self] state in self?.publish("window.oasisWallpaperUpdate", state) })

 func applicationDidFinishLaunching(_ notification:Notification){
  OasisKeychainAccess.disableInteraction()
  NSApp.setActivationPolicy(.regular)
  createMenu();createWindow()
  login.changed={[weak self] state in self?.publish("window.oasisWallpaperLoginState",state)}
  startBackend()
 }
 private func createMenu(){
  let main=NSMenu(),appItem=NSMenuItem();main.addItem(appItem);let menu=NSMenu()
  menu.addItem(withTitle:"關於 Oasis Wallpaper",action:#selector(NSApplication.orderFrontStandardAboutPanel(_:)),keyEquivalent:"")
  menu.addItem(withTitle:"檢查更新…",action:#selector(checkForUpdates),keyEquivalent:"").target=self
  menu.addItem(.separator());menu.addItem(withTitle:"隱藏 Oasis Wallpaper",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h")
  menu.addItem(.separator());menu.addItem(withTitle:"結束 Oasis Wallpaper",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
  appItem.submenu=menu
  let editItem = NSMenuItem()
  let edit = NSMenu(title: MoleLanguage.text("編輯"))
  edit.addItem(withTitle: MoleLanguage.text("剪下"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
  edit.addItem(withTitle: MoleLanguage.text("拷貝"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
  edit.addItem(withTitle: MoleLanguage.text("貼上"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
  edit.addItem(withTitle: MoleLanguage.text("全選"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
  editItem.submenu = edit
  main.addItem(editItem)
  NSApp.mainMenu=main
 }
 @objc private func checkForUpdates() {
  window?.makeKeyAndOrderFront(nil)
  NSApp.activate(ignoringOtherApps:true)
  Task { await updater.check() }
 }
 private func reserveUpdateRestart(_ reserve: Bool) async throws {
  guard backend?.isRunning == true else { return }
  guard port > 0, let url = URL(string:"http://127.0.0.1:\(port)/api/native-update-install") else { throw OasisUpdateError.busy }
  var request = URLRequest(url:url)
  request.httpMethod = "POST"
  request.timeoutInterval = 8
  request.setValue(token,forHTTPHeaderField:"X-Mole-Native")
  request.httpBody = try JSONSerialization.data(withJSONObject:["reserve":reserve])
  let (_, response) = try await URLSession.shared.data(for:request)
  guard let http = response as? HTTPURLResponse else { throw OasisUpdateError.install }
  if http.statusCode == 409 { throw OasisUpdateError.busy }
  guard http.statusCode == 200 else { throw OasisUpdateError.install }
 }
 private func createWindow(){
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:920,height:720),styleMask:[.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView],backing:.buffered,defer:false)
  window.title="Oasis Wallpaper";window.titlebarAppearsTransparent=true;window.isOpaque=false;window.backgroundColor = .clear;window.minSize=NSSize(width:500,height:500);window.isReleasedWhenClosed=false
  let root=NSVisualEffectView(frame:window.contentRect(forFrameRect:window.frame));root.material = .hudWindow;root.blendingMode = .behindWindow;root.state = .active;root.appearance=NSAppearance(named:.darkAqua);root.autoresizingMask=[.width,.height];window.contentView=root
  let frost=NSVisualEffectView(frame:root.bounds);frost.material = .popover;frost.blendingMode = .behindWindow;frost.state = .active;frost.autoresizingMask=[.width,.height];root.addSubview(frost);frostOverlay=frost
  let config=WKWebViewConfiguration();config.mediaTypesRequiringUserActionForPlayback=[];config.userContentController.add(self,name:"mole")
  let saved=UserDefaults.standard.dictionary(forKey:"oasisWallpaperAppearance") ?? [:]
  if let data=try? JSONSerialization.data(withJSONObject:saved),let json=String(data:data,encoding:.utf8){config.userContentController.addUserScript(WKUserScript(source:"window.moleThemeInitial=\(json);",injectionTime:.atDocumentStart,forMainFrameOnly:true))}
  applyAppearance(saved)
  view=WKWebView(frame:root.bounds,configuration:config);view.autoresizingMask=[.width,.height];view.setValue(false,forKey:"drawsBackground");view.underPageBackgroundColor = .clear;view.navigationDelegate=self;view.uiDelegate=self;root.addSubview(view)
  dragView=MoleWindowDragView(frame:root.bounds);root.addSubview(dragView)
  root.addSubview(OasisWallpaperResizeView(frame:root.bounds))
  mouseMonitor=NSEvent.addLocalMonitorForEvents(matching:.leftMouseDown){[weak self] event in
   guard let self,self.dragEnabled,event.window===self.window,!self.window.styleMask.contains(.fullScreen),let root=self.window.contentView else{return event}
   let point=root.convert(event.locationInWindow,from:nil),bounds=root.bounds,top=root.isFlipped ? point.y:bounds.height-point.y
   // This header has only the traffic lights and the login toggle. Keep both
   // outside the drag area, along with the navigation row and resize edges.
   guard point.x>=85,point.x<bounds.width-155,top>=7,top<78 else{return event}
   OasisWallpaperResizeView.move(self.window,from:event);return nil
  }
  view.loadHTMLString("<style>body{background:#17262d;color:white;font:16px -apple-system;padding:80px 30px}</style>正在啟動 Oasis Wallpaper…",baseURL:nil)
  window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
 }
 private func startBackend(){
  let process=Process(),pipe=Pipe();process.executableURL=Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/node");process.arguments=[resources.appendingPathComponent("OasisWallpaperServer.mjs").path];process.currentDirectoryURL=resources
  var env=ProcessInfo.processInfo.environment
  env.removeValue(forKey:"OASIS_WALLPAPER_UPDATE_READY")
  env.removeValue(forKey:"OASIS_WALLPAPER_ROLLBACK")
  for key in env.keys where key.hasPrefix("NODE_") || key.hasPrefix("DYLD_") || key=="OPENSSL_CONF" || key=="OPENSSL_MODULES" {env.removeValue(forKey:key)}
  env["MOLE_GUI_NATIVE_TOKEN"]=token;env["MOLE_GUI_APP_BUNDLE"]=Bundle.main.bundleURL.path;env["MOLE_GUI_PARENT_PID"]=String(getpid());env["PATH"]="/usr/bin:/bin:/usr/sbin:/sbin"
  process.environment=env;process.standardInput=FileHandle.nullDevice;process.standardOutput=pipe;process.standardError=FileHandle.nullDevice
  pipe.fileHandleForReading.readabilityHandler={[weak self] handle in let data=handle.availableData;guard !data.isEmpty else{return};Task{@MainActor in self?.consume(data)}}
  process.terminationHandler={[weak self] _ in Task{@MainActor in guard let self,!self.shuttingDown else{return};self.startupError()}}
  do {try process.run();backend=process;output=pipe}catch{pipe.fileHandleForReading.readabilityHandler=nil;startupError()}
 }
 private func consume(_ data:Data){
  guard port==0,outputBuffer.count<1024 else{return};outputBuffer.append(data)
  guard let line=String(data:outputBuffer,encoding:.utf8),let end=line.firstIndex(of:"\n") else{return}
  let parts=line[..<end].split(separator:" ");guard parts.count==2,parts[0]=="OASIS_WALLPAPER_READY",let value=Int(parts[1]),(1025...65535).contains(value) else{startupError();return}
  port=value;output?.fileHandleForReading.readabilityHandler=nil
  workshop.start();scenes.start();webWallpapers.start();desktops.start();view.load(URLRequest(url:URL(string:"http://127.0.0.1:\(port)/")!))
 }
 private func startupError(){view.loadHTMLString("<style>body{background:#17262d;color:white;font:16px -apple-system;padding:80px 30px;line-height:1.7}</style>無法啟動桌布服務，請關閉後重新開啟 Oasis Wallpaper。",baseURL:nil)}
 private func publish(_ function:String,_ value:Any){guard let data=try? JSONSerialization.data(withJSONObject:value,options:[.fragmentsAllowed]),let json=String(data:data,encoding:.utf8) else{return};view?.evaluateJavaScript("\(function)?.(\(json));",completionHandler:nil)}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {false}
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {window.makeKeyAndOrderFront(nil);return true}
 func applicationWillTerminate(_ notification:Notification){shuttingDown=true;if let mouseMonitor{NSEvent.removeMonitor(mouseMonitor)};desktops.stop();scenes.stop();webWallpapers.stop();workshop.stop();output?.fileHandleForReading.readabilityHandler=nil;if backend?.isRunning==true{backend?.terminate()}}
 func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
  guard let url=action.request.url else{decisionHandler(.cancel);return}
  if action.targetFrame?.isMainFrame==false {decisionHandler(url.scheme=="about" || webWallpapers.allows(url) ? .allow:.cancel);return}
  decisionHandler(url.scheme=="about" || url.host=="127.0.0.1" && url.port==port ? .allow:.cancel)
 }
 func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){
  guard frame.isMainFrame,frame.securityOrigin.host=="127.0.0.1",frame.securityOrigin.port==port else{completionHandler(nil);return}
  let panel=NSOpenPanel();panel.title="選擇背景圖片或影片";panel.canChooseFiles=true;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.begin{response in completionHandler(response == .OK ? panel.urls:nil)}
 }
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){
  guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="127.0.0.1",message.frameInfo.securityOrigin.port==port,let body=message.body as? [String:Any],let action=body["action"] as? String,let source=message.webView else{return}
  switch action {
  case "wallpaperCheckUpdate":if source === view {checkForUpdates()}
  case "wallpaperUpdateState":if source === view {publish("window.oasisWallpaperUpdate",updater.state)}
  case "wallpaperReady":if source === view {OasisWallpaperUpdateInstall.acknowledgeStartup()}
  case "appearance":if source === view {applyAppearance(body);var saved=body;saved.removeValue(forKey:"action");UserDefaults.standard.set(saved,forKey:"oasisWallpaperAppearance")}
  case "windowChrome":if source === view {dragEnabled=body["modal"] as? Bool != true;_ = dragView.update(body,in:source)}
  case "desktopScreens":desktops.publishScreens(force:true)
  case "desktopInputAccess":desktops.requestInputAccess()
  case "loginAtStartupState":login.publish()
  case "loginAtStartup":if let enabled=body["enabled"] as? Bool{login.configure(enabled)}
  case "workshopRestore":if let requestId=body["requestId"] as? String,requestId.count<100 {Task{NSApp.activate(ignoringOtherApps:true);let ok=await workshop.authorize();publish("window.oasisWorkshopRestoreResult",["requestId":requestId,"ok":ok])}}
  case "wallpaperOrigin":if let value=body["url"] as? String,let url=URL(string:value){webWallpapers.register(url)}
  case "wallpaperReplay":if let id=body["id"] as? String{scenes.replay(source,id:id);webWallpapers.replay(source,id:id)}
  case "wallpaperPreview":if let id=body["id"] as? String{webWallpapers.preview(source,id:id)}
  case "wallpaperInteract":if let id=body["id"] as? String{webWallpapers.interact(source,id:id)}
  case "wallpaperPointer":if body["kind"] as? String=="move"{webWallpapers.pointer(source,value:body);scenes.pointer(source,value:body)}
  case "wallpaperPropertyFile":if let id=body["id"] as? String,let key=body["key"] as? String,let kind=body["kind"] as? String {pickProperty(source,id:id,key:key,kind:kind,clear:body["clear"] as? Bool == true,surface:body["surface"] as? String ?? "app",screen:body["screen"] as? String ?? "")}
  case "weatherLocation":if let id=body["requestId"] as? String,id.count<100{location.locate(requestPermission:body["requestPermission"] as? Bool == true){[weak self] result in self?.publish("window.oasisWeatherLocationResult",["requestId":id,"result":result])}}
  default:break
  }
 }
 private func applyAppearance(_ value:[String:Any]) {
  let frost=value["glassFrost"] as? Double ?? 150
  frostOverlay?.alphaValue = min(0.9,max(0,frost.isFinite ? frost/500 : 0.3))
  let dark=value["dark"] as? Bool ?? true
  window?.contentView?.appearance=NSAppearance(named:dark ? .darkAqua:.aqua)
 }
 private func pickProperty(_ view:WKWebView,id:String,key:String,kind:String,clear:Bool,surface:String,screen:String){
  guard id.range(of:"^custom-[a-f0-9-]{36}$",options:.regularExpression) != nil,!key.isEmpty,key.count<=128,["file","directory","texture","scenetexture"].contains(kind),["app","menu","desktop"].contains(surface),surface != "desktop" || screen.range(of:"^[A-Za-z0-9_-]{1,80}$",options:.regularExpression) != nil else{return}
  func save(_ path:String?){
   guard let data=try? JSONSerialization.data(withJSONObject:["propertyAsset":["id":id,"key":key,"path":path as Any? ?? NSNull(),"surface":surface,"screen":screen]]),let url=URL(string:"http://127.0.0.1:\(port)/api/native-scene") else{return}
   var request=URLRequest(url:url);request.httpMethod="POST";request.setValue(token,forHTTPHeaderField:"X-Mole-Native");request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=data
   Task{[weak self] in let response=try? await URLSession.shared.data(for:request);self?.publish("window.oasisWallpaperAssetResult",["ok":(response?.1 as? HTTPURLResponse)?.statusCode==200])}
  }
  if clear{save(nil);return}
  let panel=NSOpenPanel();panel.title=kind=="directory" ? "選擇壁紙資料夾":"選擇壁紙檔案";panel.canChooseFiles=kind != "directory";panel.canChooseDirectories=kind=="directory";panel.allowsMultipleSelection=false;panel.canCreateDirectories=false;panel.begin{response in if response == .OK,let url=panel.url{save(url.path)}}
 }
}

@main struct OasisWallpaperMain {
 static func main(){
  let arguments=CommandLine.arguments
  switch arguments.dropFirst().first {
  case "--prepare-weather-media":exit(OasisWeatherMedia.run())
  case "--clone-wallpaper-tree":exit(OasisWallpaperClone.run())
  case "--install-wallpaper-update":exit(OasisWallpaperUpdateInstall.run(Array(arguments.dropFirst(2))))
  default:let app=NSApplication.shared,delegate=WallpaperApp();app.delegate=delegate;app.run();withExtendedLifetime(delegate){}
  }
 }
}
