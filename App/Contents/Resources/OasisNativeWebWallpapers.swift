import Cocoa
import WebKit
import CoreImage
import QuartzCore

// The native Web and Metal surfaces live behind the App's transparent UI.
// Apply adjustments to those surfaces only, never to the controls above them.
enum OasisWallpaperPresentation {
 static func apply(_ view:NSView,_ data:[String:Any]?) {
  guard let layer=view.layer else{return};let d=data ?? [:]
  func number(_ key:String,_ fallback:Double,_ min:Double,_ max:Double)->Double {let v=(d[key] as? NSNumber)?.doubleValue ?? fallback;return v.isFinite ? Swift.max(min,Swift.min(max,v)):fallback}
  let brightness=number("brightness",100,0,200),saturation=number("saturation",100,0,200),hue=number("hue",0,-180,180)
  if brightness==100 && saturation==100 && hue==0 {layer.filters=nil}
  else {let color=CIFilter(name:"CIColorControls")!,angle=CIFilter(name:"CIHueAdjust")!;color.setValue(saturation/100,forKey:kCIInputSaturationKey);color.setValue((brightness-100)/100,forKey:kCIInputBrightnessKey);angle.setValue(hue * .pi / 180,forKey:kCIInputAngleKey);layer.filters=[color,angle]}
  let x=number("x",0,-100,100),y=number("y",0,-100,100),scale=number("scale",100,50,200)/100
  layer.transform=CATransform3DConcat(CATransform3DMakeScale(scale,scale,1),CATransform3DMakeTranslation(CGFloat(x/100)*view.bounds.width,CGFloat(-y/100)*view.bounds.height,0))
 }
}

private final class OasisWallpaperWebView:WKWebView {
 var interactive=false
 override func hitTest(_ point:NSPoint)->NSView? {interactive ? super.hitTest(point):nil}
}

/// Background pages have a distinct WebKit process pool, ephemeral storage,
/// their own loopback origin and one readiness-only handler. No Oasis bridge.
@MainActor
final class OasisNativeWebWallpapers:NSObject,WKNavigationDelegate,WKUIDelegate,WKScriptMessageHandler {
 private final class Entry {
  let id:String,web:WKWebView,parent:WKWebView,revision:Int;var ready=false,preview=false,preflightOnly=false,compact=false
  init(_ id:String,_ web:WKWebView,_ parent:WKWebView,revision:Int){self.id=id;self.web=web;self.parent=parent;self.revision=revision}
 }
 private let port:Int,token:String,views:()->[(WKWebView,Bool,Bool)],height:()->CGFloat
 private let desktopScreen:String?,audioAllowed:()->Bool,shouldPause:()->Bool
 private let healthScript:String
 private let pool=WKProcessPool()
 private var previewWindow:NSWindow?,previewParent:WKWebView?,previewObserver:NSObjectProtocol?
 private var interacting:Entry?,hiddenViews:[(NSView,Bool)]=[],doneButton:NSButton?,keyMonitor:Any?
 private var presentationKey:String?
 private var timer:Timer?,entries:[ObjectIdentifier:Entry]=[:],retired:[Entry]=[],busy=false,reported=Set<String>(),request:[String:Any]?,origin:URL?,recoveries:[String:Int]=[:]
 init(port:Int,token:String,views:@escaping()->[(WKWebView,Bool,Bool)],compactHeight:@escaping()->CGFloat,healthScript:String?=nil,desktopScreen:String?=nil,audioAllowed:@escaping()->Bool={true},shouldPause:@escaping()->Bool={false}){self.port=port;self.token=token;self.views=views;self.height=compactHeight;self.desktopScreen=desktopScreen;self.audioAllowed=audioAllowed;self.shouldPause=shouldPause;self.healthScript=healthScript ?? Bundle.main.url(forResource:"OasisWallpaperHealth",withExtension:"js").flatMap{try? String(contentsOf:$0,encoding:.utf8)} ?? "";super.init()}
 func start(){stop();timer=Timer.scheduledTimer(withTimeInterval:1,repeats:true){[weak self] _ in Task{await self?.poll()}};Task{await poll()}}
 func stop(){endInteraction();closePreview();reported.removeAll();timer?.invalidate();timer=nil;for item in Array(entries.values)+retired{release(item)};entries.removeAll();retired.removeAll();request=nil;presentationKey=nil}
 private func release(_ entry:Entry){if interacting === entry {endInteraction()};entry.web.configuration.userContentController.removeScriptMessageHandler(forName:"oasisWallpaperReady");entry.web.stopLoading();entry.web.loadHTMLString("",baseURL:nil);entry.web.removeFromSuperview()}
 func register(_ url:URL){guard url.scheme=="http",url.host=="127.0.0.1",let value=url.port,value != port,value>1024,url.path.range(of:"^/[a-f0-9]{48}/custom-[a-f0-9-]{36}/",options:.regularExpression) != nil else{return};origin=URL(string:"http://127.0.0.1:\(value)")}
 func allows(_ url:URL)->Bool {url.scheme=="http"&&url.host=="127.0.0.1"&&url.port==origin?.port}
 func replay(_ parent:WKWebView,id:String){guard let entry=entries[ObjectIdentifier(parent)],entry.id==id,entry.ready else{return};publish(entry,ready:true)}
 func pointer(_ parent:WKWebView,value:[String:Any]){
  guard let entry=entries[ObjectIdentifier(parent)],entry.ready,let x=value["x"] as? Double,let y=value["y"] as? Double,x.isFinite,y.isFinite,value["kind"] as? String == "move" else{return}
  var px=max(0,min(1,x))*Double(entry.web.bounds.width),py=max(0,min(1,y))*Double(entry.web.bounds.height)
  if desktopScreen != nil,let root=entry.web.superview {
   let windowPoint=root.convert(NSPoint(x:x*root.bounds.width,y:(1-y)*root.bounds.height),to:nil)
   guard let point=desktopLocalPoint(entry,windowPoint:windowPoint),entry.web.bounds.contains(point) else{return}
   px=point.x;py=entry.web.isFlipped ? point.y:entry.web.bounds.height-point.y
  }
  entry.web.evaluateJavaScript("(()=>{const options={clientX:\(px),clientY:\(py),bubbles:true};const target=document.elementFromPoint(\(px),\(py))||document.body;target.dispatchEvent(new MouseEvent('mousemove',options))})()",completionHandler:nil)
 }
 private func desktopLocalPoint(_ entry:Entry,windowPoint:NSPoint)->NSPoint? {
  guard let root=entry.web.superview,let rootLayer=root.layer,let webLayer=entry.web.layer else{return nil}
  return webLayer.convert(root.convert(windowPoint,from:nil),from:rootLayer)
 }
 /// Desktop clicks come from the Finder's empty background. They use native
 /// WebKit events so ordinary buttons and sliders receive a real user gesture.
 /// App and Menu Bar surfaces never use this route.
 func acceptsDesktopMouse(_ parent:WKWebView)->Bool {
  guard desktopScreen != nil,!shouldPause(),request?["preparing"] as? Bool != true,let entry=entries[ObjectIdentifier(parent)] else{return false}
  return entry.ready && !entry.preview && entry.web.window != nil
 }
 func desktopMouse(_ parent:WKWebView,event:NSEvent,screenPoint:NSPoint) {
  guard acceptsDesktopMouse(parent),let entry=entries[ObjectIdentifier(parent)],let window=entry.web.window,
        [.leftMouseDown,.leftMouseUp,.leftMouseDragged].contains(event.type) else{return}
  let windowPoint=window.convertPoint(fromScreen:screenPoint)
  guard let local=desktopLocalPoint(entry,windowPoint:windowPoint) else{return}
  let location=entry.web.convert(local,to:nil)
  guard let forwarded=NSEvent.mouseEvent(with:event.type,location:location,modifierFlags:event.modifierFlags,
      timestamp:event.timestamp,windowNumber:window.windowNumber,context:nil,eventNumber:event.eventNumber,
      clickCount:event.clickCount,pressure:event.pressure) else{return}
  switch event.type {case .leftMouseDown:entry.web.mouseDown(with:forwarded);case .leftMouseDragged:entry.web.mouseDragged(with:forwarded);case .leftMouseUp:entry.web.mouseUp(with:forwarded);default:break}
 }
 private func native(_ body:[String:Any]) async->[String:Any]?{
  var payload=body;if let desktopScreen{payload["desktopHost"]=true;payload["screen"]=desktopScreen}
  var r=URLRequest(url:URL(string:"http://127.0.0.1:\(port)/api/native-scene")!);r.httpMethod="POST";r.timeoutInterval=5;r.setValue(token,forHTTPHeaderField:"X-Mole-Native");r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.httpBody=try? JSONSerialization.data(withJSONObject:payload)
  guard let (data,response)=try? await URLSession.shared.data(for:r),let status=response as? HTTPURLResponse,status.statusCode==200,data.count<2097152 else{return nil};return try? JSONSerialization.jsonObject(with:data) as? [String:Any]
 }
 private func poll() async{
  guard !busy else{return};busy=true;defer{busy=false};guard let data=await native(["webHost":true]) else{return}
  let surfaces=views(),desktop=data["desktop"] as? [String:Any] ?? [:],appYields=desktopScreen==nil && (data["desktopAudioActive"] as? Bool ?? (desktop["enabled"] as? Bool == true && desktop["audio"] as? Bool == true))
  func wantsAudio(_ compact:Bool)->Bool {let incoming=data["web"] as? [String:Any],selected=incoming?["preflightOnly"] as? Bool == true ? request:incoming,surface=compact ? (selected?["menu"] as? [String:Any] ?? selected):selected,display=surface?["display"] as? [String:Any] ?? data[compact ? "menuDisplay":"display"] as? [String:Any] ?? [:];return display["audio"] as? Bool == true && ((display["volume"] as? NSNumber)?.doubleValue ?? 50)>0}
  let owner=audioAllowed() && !shouldPause() && !appYields ? (surfaces.first(where:{$0.1 && !$0.2 && wantsAudio(false)})?.0 ?? surfaces.first(where:{$0.1 && wantsAudio($0.2)})?.0):nil
  // Mute all non-owner views before enabling the one visible audio surface.
  for (view,_,_) in surfaces where view !== owner {_ = try? await view.evaluateJavaScript("window.oasisWallpaperAudioOwner?.(false)");if let old=entries[ObjectIdentifier(view)]{_ = try? await old.web.evaluateJavaScript("window.postMessage({type:'oasis-wallpaper-control',audio:false,volume:0},location.origin)")}}
  if let owner {_ = try? await owner.evaluateJavaScript("window.oasisWallpaperAudioOwner?.(true)")}
  if let key=data["presentationKey"] as? String,key != presentationKey {presentationKey=key;for (parent,_,_) in views(){parent.evaluateJavaScript("window.OasisWeather?.refresh();",completionHandler:nil)}}
  if let value=data["webOrigin"] as? String,let url=URL(string:value){origin=url}
  let next=data["web"] as? [String:Any]
  if next?["id"] as? String != request?["id"] as? String || next?["revision"] as? Int != request?["revision"] as? Int {reported.removeAll();recoveries.removeAll();if next?["id"] as? String == request?["id"] as? String,next?["id"] as? String != nil {for entry in Array(entries.values)+retired{release(entry)};entries.removeAll();retired.removeAll()}}
  request=next
  guard let selected=request,let id=selected["id"] as? String,let value=selected["url"] as? String,let url=URL(string:value),selected["enabled"] as? Bool != false else{closePreview();for entry in Array(entries.values)+retired{release(entry)};entries.removeAll();retired.removeAll();return}
  register(url)
  if let parent=previewParent,entries[ObjectIdentifier(parent)]?.id != id{closePreview()}
  for (parent,visible,compact) in surfaces{
   let key=ObjectIdentifier(parent)
   if let old=entries[key],old.id != id{entries.removeValue(forKey:key);if old.preflightOnly{release(old)}else{if selected["preflightOnly"] as? Bool != true {_ = try? await old.web.evaluateJavaScript("window.postMessage({type:'oasis-wallpaper-control',audio:false,volume:0},location.origin)")};retired.append(old)}}
   guard visible else{if let old=entries.removeValue(forKey:key){publish(old,ready:false);release(old)};continue}
   if entries[key]==nil,let index=retired.firstIndex(where:{$0.parent===parent && $0.id==id && $0.ready}){entries[key]=retired.remove(at:index)}
   if entries[key]==nil {create(id,parent:parent,url:url,compact:compact)}
   guard let entry=entries[key] else{continue};entry.compact=compact;layout(entry,parent:parent,compact:compact)
   let surface=compact ? (selected["menu"] as? [String:Any] ?? selected):selected
   if entry.ready {entry.web.alphaValue=selected["preflightOnly"] as? Bool == true ? 0:interacting === entry ? 1:CGFloat(selected["intensity"] as? Double ?? 0.45);OasisWallpaperPresentation.apply(entry.web,surface["display"] as? [String:Any]);applyProperties(entry,audible:parent === owner && selected["preparing"] as? Bool != true)}
  }
 }
 private func layout(_ entry:Entry,parent:WKWebView,compact:Bool){let h=compact ? max(parent.bounds.height,height()):parent.bounds.height;entry.web.frame=NSRect(x:0,y:parent.bounds.height-h,width:parent.bounds.width,height:h)}
 private func create(_ id:String,parent:WKWebView,url:URL,compact:Bool,interactive:Bool=false){
  guard let root=parent.superview else{return}
  let config=WKWebViewConfiguration();config.processPool=pool;config.websiteDataStore = .nonPersistent();config.mediaTypesRequiringUserActionForPlayback = [];config.allowsAirPlayForMediaPlayback=false;config.preferences.javaScriptCanOpenWindowsAutomatically=false
  config.userContentController.add(self,name:"oasisWallpaperReady")
  config.userContentController.addUserScript(WKUserScript(source:"window.__oasisHideWallpaperUI=\(desktopScreen == nil && !interactive ? "true":"false");",injectionTime:.atDocumentStart,forMainFrameOnly:true))
  let script=healthScript
  config.userContentController.addUserScript(WKUserScript(source:script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
  let web:WKWebView=interactive ? WKWebView(frame:parent.frame,configuration:config):OasisWallpaperWebView(frame:parent.frame,configuration:config);web.autoresizingMask=[.width,.height];web.wantsLayer=true;web.navigationDelegate=self;web.uiDelegate=self;web.setValue(false,forKey:"drawsBackground");web.underPageBackgroundColor = .clear;web.alphaValue=0
  let entry=Entry(id,web,parent,revision:request?["revision"] as? Int ?? 0);entry.preview=interactive;entry.compact=compact;entry.preflightOnly=request?["preflightOnly"] as? Bool == true;entries[ObjectIdentifier(parent)]=entry;layout(entry,parent:parent,compact:compact);root.addSubview(web,positioned:.below,relativeTo:parent);web.load(URLRequest(url:url))
 }
 func preview(_ parent:WKWebView,id:String){
  guard request?["id"] as? String==id,let source=request?["url"] as? String,let url=URL(string:source) else{return}
  closePreview()
  let window=NSWindow(contentRect:NSRect(x:180,y:150,width:900,height:600),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false);window.title="Oasis 背景預覽";window.isReleasedWhenClosed=false
  let root=NSView(frame:NSRect(x:0,y:0,width:900,height:600));window.contentView=root;let anchor=WKWebView(frame:root.bounds);anchor.autoresizingMask=[.width,.height];anchor.isHidden=true;root.addSubview(anchor)
  previewWindow=window;previewParent=anchor;create(id,parent:anchor,url:url,compact:false,interactive:true)
  previewObserver=NotificationCenter.default.addObserver(forName:NSWindow.willCloseNotification,object:window,queue:.main){[weak self,weak window] _ in Task{@MainActor in guard let self,let window,self.previewWindow===window else{return};self.closePreview()}}
  window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
 }
 func interact(_ parent:WKWebView,id:String){
  guard let entry=entries[ObjectIdentifier(parent)],entry.id==id,entry.ready,let web=entry.web as? OasisWallpaperWebView,let root=parent.superview else{return}
  endInteraction();closePreview();interacting=entry
  hiddenViews=root.subviews.filter{$0 !== web}.map{($0,$0.isHidden)};for (view,_) in hiddenViews {view.isHidden=true}
  web.interactive=true;web.alphaValue=1
  applyProperties(entry,audible:false)
  let button=NSButton(title:"完成",target:self,action:#selector(endInteraction));button.bezelStyle = .rounded;button.controlSize = .large;button.frame=NSRect(x:max(16,root.bounds.width-104),y:max(16,root.bounds.height-62),width:80,height:32);button.autoresizingMask=[.minXMargin,.minYMargin];button.setAccessibilityLabel("完成壁紙調整");root.addSubview(button);doneButton=button
  parent.window?.makeFirstResponder(web)
  keyMonitor=NSEvent.addLocalMonitorForEvents(matching:.keyDown){[weak self,weak parent] event in guard event.keyCode==53,event.window===parent?.window else{return event};Task{@MainActor in self?.endInteraction()};return nil}
 }
 @objc private func endInteraction(){
  let previousParent=interacting?.parent
  if let entry=interacting {if let web=entry.web as? OasisWallpaperWebView {web.interactive=false};entry.web.alphaValue=CGFloat(request?["intensity"] as? Double ?? 0.45)}
  let previous=interacting;interacting=nil;if let previous{applyProperties(previous,audible:false)};doneButton?.removeFromSuperview();doneButton=nil;for (view,wasHidden) in hiddenViews {view.isHidden=wasHidden};hiddenViews=[]
  if let parent=previousParent,!parent.isHidden {parent.window?.makeFirstResponder(parent)}
  if let keyMonitor {NSEvent.removeMonitor(keyMonitor)};keyMonitor=nil
 }
 private func closePreview(){
  if let previewObserver{NotificationCenter.default.removeObserver(previewObserver)};previewObserver=nil
  if let previewParent,let entry=entries.removeValue(forKey:ObjectIdentifier(previewParent)){release(entry)}
  let window=previewWindow;previewWindow=nil;previewParent=nil;window?.close()
 }
 private func applyProperties(_ entry:Entry,audible:Bool=false){
  let surface=entry.compact ? (request?["menu"] as? [String:Any] ?? request ?? [:]):(request ?? [:]),display=surface["display"] as? [String:Any] ?? [:]
  let body:[String:Any]=["type":"oasis-wallpaper-control","paused":shouldPause() && entry.ready,"hideUI":desktopScreen == nil && !entry.preview && interacting !== entry,"properties":surface["properties"] as? [String:Any] ?? [:],"audio":audible && (display["audio"] as? Bool == true),"volume":display["volume"] as? Double ?? 50,"fps":request?["fps"] as? Int ?? 30]
  guard let data=try? JSONSerialization.data(withJSONObject:body),let json=String(data:data,encoding:.utf8) else{return}
  entry.web.evaluateJavaScript("window.postMessage(\(json),location.origin)",completionHandler:nil)
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){if let entry=entries.values.first(where:{$0.web===webView}){applyProperties(entry)}}
 private func publish(_ entry:Entry,ready:Bool){guard let data=try? JSONSerialization.data(withJSONObject:["id":entry.id,"ready":ready]),let json=String(data:data,encoding:.utf8) else{return};entry.parent.evaluateJavaScript("window.oasisNativeSceneState?.(\(json));window.OasisWeather?.refresh();",completionHandler:nil)}
 func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){
  guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host==origin?.host,message.frameInfo.securityOrigin.port==origin?.port,let web=message.webView,let entry=entries.values.first(where:{$0.web===web}),!entry.ready else{return}
  guard let value=message.body as? [String:Any],let ready=value["ready"] as? Bool else{return}
  if !ready {let allowed=["web-media","web-script","web-resource","web-render-timeout"];failed(web,reason:allowed.contains(value["reason"] as? String ?? "") ? value["reason"] as! String:"web-load-failed");return}
  entry.ready=true;applyProperties(entry);entry.web.alphaValue=entry.preflightOnly ? 0:entry.preview ? 1:CGFloat(request?["intensity"] as? Double ?? 0.45)
  if !entry.preflightOnly {publish(entry,ready:true);for old in retired where old.parent===entry.parent {release(old)};retired.removeAll(where:{$0.parent===entry.parent})}
  if reported.insert(entry.id+":ready").inserted {Task{_=await native(["id":entry.id,"state":"ready"])}}
 }
 func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let url=navigationAction.request.url else{decisionHandler(.cancel);return};decisionHandler(url.scheme=="about"||allows(url)||navigationAction.targetFrame?.isMainFrame==false&&url.scheme=="https" ? .allow:.cancel)}
 func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){failed(webView)}
 func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){failed(webView)}
 func webViewWebContentProcessDidTerminate(_ webView:WKWebView){guard let entry=entries.values.first(where:{$0.web===webView}) else{return};let count=recoveries[entry.id,default:0];if count<2 {recoveries[entry.id]=count+1;entry.ready=false;webView.reload()}else{failed(webView,reason:"web-process-terminated")}}
 private func failed(_ web:WKWebView,reason:String="web-load-failed"){guard let entry=entries.values.first(where:{$0.web===web}) else{return};if entry.preview {entry.web.alphaValue=1;entry.web.loadHTMLString("<html><body style='background:transparent;color:white;font:14px -apple-system;display:grid;place-items:center;height:90vh'>預覽暫時無法載入，請關閉後重試。</body></html>",baseURL:nil);return};guard reported.insert(entry.id+":error").inserted else{return};Task{_=await native(["id":entry.id,"state":"error","reason":reason,"revision":entry.revision])}}
 func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){
  guard interacting?.web === webView || entries.values.contains(where:{$0.preview && $0.web === webView}) else{completionHandler(nil);return}
  let panel=NSOpenPanel();panel.canChooseFiles = !parameters.allowsDirectories;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.begin{result in completionHandler(result == .OK ? panel.urls:nil)}
 }
 private func interactiveWindow(_ web:WKWebView)->NSWindow? {guard interacting?.web === web || entries.values.contains(where:{$0.preview && $0.web === web}) else{return nil};return web.window}
 func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){
  guard let window=interactiveWindow(webView) else{completionHandler();return};let alert=NSAlert();alert.messageText="壁紙訊息";alert.informativeText=String(message.prefix(2000));alert.addButton(withTitle:"好");alert.beginSheetModal(for:window){_ in completionHandler()}
 }
 func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){
  guard let window=interactiveWindow(webView) else{completionHandler(false);return};let alert=NSAlert();alert.messageText="壁紙詢問";alert.informativeText=String(message.prefix(2000));alert.addButton(withTitle:"確定");alert.addButton(withTitle:"取消");alert.beginSheetModal(for:window){result in completionHandler(result == .alertFirstButtonReturn)}
 }
 func webView(_ webView:WKWebView,runJavaScriptTextInputPanelWithPrompt prompt:String,defaultText:String?,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(String?)->Void){
  guard let window=interactiveWindow(webView) else{completionHandler(nil);return};let alert=NSAlert();alert.messageText="壁紙輸入";alert.informativeText=String(prompt.prefix(2000));let input=NSTextField(string:String((defaultText ?? "").prefix(4096)));input.frame=NSRect(x:0,y:0,width:300,height:24);alert.accessoryView=input;alert.addButton(withTitle:"確定");alert.addButton(withTitle:"取消");alert.beginSheetModal(for:window){result in completionHandler(result == .alertFirstButtonReturn ? String(input.stringValue.prefix(4096)):nil)}
 }
 func webView(_ webView:WKWebView,requestMediaCapturePermissionFor origin:WKSecurityOrigin,initiatedByFrame frame:WKFrameInfo,type:WKMediaCaptureType,decisionHandler:@escaping(WKPermissionDecision)->Void){decisionHandler(.deny)}
}
