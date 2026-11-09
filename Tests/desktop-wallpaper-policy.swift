import Foundation
import CoreGraphics

@main struct DesktopWallpaperPolicyTests {
 @MainActor static func main() {
  let settings:[String:Any]=["ac":"play","battery":"pause","focused":"play","maximized":"pause","fullscreen":"stop","sleep":"stop"]
  precondition(OasisDesktopWallpapers.action(settings,battery:false,asleep:false,focused:false,maximized:false,fullscreen:false)=="play")
  precondition(OasisDesktopWallpapers.action(settings,battery:true,asleep:false,focused:false,maximized:false,fullscreen:false)=="pause")
  precondition(OasisDesktopWallpapers.action(settings,battery:false,asleep:false,focused:true,maximized:true,fullscreen:false)=="pause")
  precondition(OasisDesktopWallpapers.action(settings,battery:true,asleep:false,focused:true,maximized:false,fullscreen:true)=="stop")
  precondition(OasisDesktopWallpapers.action(settings,battery:false,asleep:true,focused:false,maximized:false,fullscreen:false)=="stop")
  let primary=CGRect(x:0,y:0,width:1920,height:1080),second=CGRect(x:1920,y:0,width:1920,height:1080),dockLevel=Int(CGWindowLevelForKey(.dockWindow))
  func dock(_ owner:pid_t?,_ level:Int,_ bounds:CGRect,_ dockPID:pid_t?=42)->Bool {OasisDesktopWallpapers.isFullDisplayDockWindow(owner:owner,level:level,bounds:bounds,dockPID:dockPID,displays:[primary,second])}
  precondition(dock(42,dockLevel,primary));precondition(dock(42,dockLevel,second))
  precondition(!dock(41,dockLevel,primary));precondition(!dock(42,0,primary));precondition(!dock(42,dockLevel,CGRect(x:0,y:300,width:56,height:500)));precondition(!dock(42,dockLevel,primary,nil));precondition(!dock(42,dockLevel,CGRect(x:1,y:0,width:1920,height:1080)))
  precondition(dock(42,18,primary));precondition(dock(42,18,second))
  precondition(!dock(41,18,primary));precondition(!dock(42,18,CGRect(x:0,y:300,width:56,height:500)))
  precondition(!dock(42,dockLevel+1,primary));precondition(!dock(42,-1,primary))
  let screens=[("A","play"),("B","play"),("C","pause")]
  precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["B"])=="B");precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["C"])==nil);precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:nil)=="A")
  precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["B","A"])=="B");precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["C","A"])=="A")
  precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["A","B"],preferred:"B")=="B");precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["A"],preferred:"B")=="A");precondition(OasisDesktopWallpapers.audioScreen(screens,eligible:["A","C"],preferred:"C")=="A")
  print("Desktop wallpaper policy: 26 checks passed")
 }
}
