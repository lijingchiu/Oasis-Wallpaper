import Cocoa

// Only the outer few points receive resize gestures; all controls and the
// scrollable WebKit content continue to receive their normal mouse events.
@MainActor
final class OasisWallpaperResizeView:NSView {
 private let margin:CGFloat = 7
 override var isFlipped:Bool { true }
 override init(frame:NSRect){super.init(frame:frame);autoresizingMask=[.width,.height];setAccessibilityElement(false)}
 required init?(coder:NSCoder){nil}
 struct Edges:OptionSet {let rawValue:Int;static let left=Edges(rawValue:1),right=Edges(rawValue:2),top=Edges(rawValue:4),bottom=Edges(rawValue:8)}
 func edges(at p:NSPoint)->Edges {
  guard bounds.contains(p) else{return []};var result:Edges=[]
  if p.x<margin {result.insert(.left)} else if p.x>bounds.width-margin {result.insert(.right)}
  if p.y<margin {result.insert(.top)} else if p.y>bounds.height-margin {result.insert(.bottom)}
  return result
 }
 override func hitTest(_ point:NSPoint)->NSView? {edges(at:convert(point,from:superview)).isEmpty ? nil:self}
 override func acceptsFirstMouse(for event:NSEvent?)->Bool {true}
 static func move(_ window:NSWindow,from event:NSEvent){
  guard event.type == .leftMouseDown,window.isMovable else{return}
  let origin=window.frame.origin,start=NSEvent.mouseLocation
  while let next=NSApp.nextEvent(matching:[.leftMouseDragged,.leftMouseUp],until:.distantFuture,inMode:.eventTracking,dequeue:true){
   if next.type == .leftMouseUp {break}
   let point=NSEvent.mouseLocation;window.setFrameOrigin(NSPoint(x:origin.x+point.x-start.x,y:origin.y+point.y-start.y))
  }
 }
 static func resized(_ original:NSRect,delta:NSPoint,edges:Edges,minSize:NSSize,maxSize:NSSize)->NSRect {
  var result=original
  if edges.contains(.left){let width=max(minSize.width,min(maxSize.width,original.width-delta.x));result.origin.x=original.maxX-width;result.size.width=width}
  if edges.contains(.right){result.size.width=max(minSize.width,min(maxSize.width,original.width+delta.x))}
  if edges.contains(.bottom){let height=max(minSize.height,min(maxSize.height,original.height-delta.y));result.origin.y=original.maxY-height;result.size.height=height}
  if edges.contains(.top){result.size.height=max(minSize.height,min(maxSize.height,original.height+delta.y))}
  return result
 }
 override func mouseDown(with event:NSEvent){
  guard let window,!window.styleMask.contains(.fullScreen) else{return}
  let direction=edges(at:convert(event.locationInWindow,from:nil));guard !direction.isEmpty else{return}
  let initial=window.frame,start=NSEvent.mouseLocation
  while let next=NSApp.nextEvent(matching:[.leftMouseDragged,.leftMouseUp],until:.distantFuture,inMode:.eventTracking,dequeue:true){
   if next.type == .leftMouseUp {break}
   let point=NSEvent.mouseLocation,delta=NSPoint(x:point.x-start.x,y:point.y-start.y)
   window.setFrame(Self.resized(initial,delta:delta,edges:direction,minSize:window.minSize,maxSize:window.maxSize),display:true)
  }
 }
 override func resetCursorRects(){
  addCursorRect(NSRect(x:0,y:margin,width:margin,height:max(0,bounds.height-2*margin)),cursor:.resizeLeftRight)
  addCursorRect(NSRect(x:bounds.width-margin,y:margin,width:margin,height:max(0,bounds.height-2*margin)),cursor:.resizeLeftRight)
  addCursorRect(NSRect(x:margin,y:0,width:max(0,bounds.width-2*margin),height:margin),cursor:.resizeUpDown)
  addCursorRect(NSRect(x:margin,y:bounds.height-margin,width:max(0,bounds.width-2*margin),height:margin),cursor:.resizeUpDown)
 }
}
