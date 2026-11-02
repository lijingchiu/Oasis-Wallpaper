// Run against the standalone service with isolated data:
// swift Tests/wallpaper-sidebar-layout.swift http://127.0.0.1:PORT/
import AppKit
import Foundation
import WebKit

guard CommandLine.arguments.count == 2,
      let url = URL(string: CommandLine.arguments[1]),
      url.scheme == "http", url.host == "127.0.0.1" else {
    fatalError("Provide the URL of an isolated local wallpaper service")
}

let application = NSApplication.shared
let window = NSWindow(contentRect: NSRect(x: 10, y: 10, width: 920, height: 720), styleMask: [.titled], backing: .buffered, defer: false)
let config = WKWebViewConfiguration()
config.userContentController.addUserScript(WKUserScript(source: """
(() => {
  const original = window.fetch.bind(window);
  window.__browseRequests = 0;
  window.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/weather/workshop/browse')) {
      window.__browseRequests++;
      return Promise.resolve(new Response(JSON.stringify({ok:true,items:[],hasMore:false}),
        {status:200,headers:{'Content-Type':'application/json'}}));
    }
    return original(input, options);
  };
})();
""", injectionTime: .atDocumentStart, forMainFrameOnly: true))
let web = WKWebView(frame: window.contentView!.bounds, configuration: config)
web.autoresizingMask = [.width, .height]
window.contentView!.addSubview(web)
window.orderBack(nil)

final class Test: NSObject, WKNavigationDelegate {
    let endpoint: URL
    init(endpoint: URL) { self.endpoint = endpoint }
    var cases: [(String, Int, Int)] = [("library", 1680, 720), ("library", 1200, 720), ("library", 920, 720), ("library", 800, 720), ("library", 920, 500), ("workshop", 1680, 720), ("workshop", 1200, 720), ("workshop", 920, 720), ("workshop", 800, 720), ("workshop", 920, 500), ("library", 680, 720), ("library", 500, 500), ("workshop", 680, 720), ("workshop", 500, 500), ("settings", 1680, 720), ("settings", 920, 720), ("settings", 500, 500), ("appearance", 1680, 720), ("appearance", 500, 500)]
    var current: (String, Int, Int) = ("", 0, 0)
    var failures = 0

    func next() {
        guard !cases.isEmpty else { print(failures == 0 ? "PASS" : "FAIL: \(failures) cases"); exit(failures == 0 ? 0 : 1) }
        current = cases.removeFirst()
        window.setContentSize(NSSize(width: current.1, height: current.2))
        web.load(URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = """
        const page = PAGE;
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const require = (condition, message) => { if (!condition) throw Error(message); };
        for (let i=0; i<50 && !window.OasisWeather; i++) await sleep(50);
        require(!!window.OasisWeather, 'weather UI did not load');
        window.oasisDesktopScreens([{id:'display-a',name:'Test display',width:1920,height:1080}]);
        if (page === 'appearance') {
          document.querySelector('[data-page-tab="appearance"]').click(); await sleep(150);
          const panel=document.querySelector('#wallpaper-appearance');
          require(!panel.hidden && panel.querySelectorAll('[data-glass-setting]').length===6,'glass controls unavailable');
          require(getComputedStyle(panel.querySelector('.appearance-colors')).display==='none','custom colors should be hidden outside custom mode');
          const slider=panel.querySelector('[data-glass-setting="glassSurfaceOpacity"]');
          slider.value='70';slider.dispatchEvent(new Event('input',{bubbles:true}));
          require(window.MoleTheme.get().glassSurfaceOpacity===70,'glass setting not applied');
          require(panel.querySelector('[data-glass-output="glassSurfaceOpacity"]').textContent==='70%','glass value not updated');
          panel.querySelector('.appearance-glass-reset').click();
          require(window.MoleTheme.get().glassSurfaceOpacity===50,'glass reset failed');
          const header=document.querySelector('.wallpaper-chrome').getBoundingClientRect(),bounds=panel.getBoundingClientRect();
          require(bounds.top-header.bottom>=19 && bounds.right<=window.innerWidth+1,'appearance layout clipped');
          return JSON.stringify({page,width:window.innerWidth,gap:bounds.top-header.bottom});
        }
        if (page === 'settings') {
          document.querySelector('[data-page-tab="settings"]').click();
          await sleep(150);
          const header=document.querySelector('.wallpaper-chrome').getBoundingClientRect();
          const panel=document.querySelector('.wx-desktop-settings').getBoundingClientRect();
          require(panel.top-header.bottom >= 19, 'settings panel is too close to navigation: '+(panel.top-header.bottom));
          require(panel.right <= window.innerWidth+1, 'settings panel overflows window');
          return JSON.stringify({page,width:window.innerWidth,gap:panel.top-header.bottom});
        }
        if (page === 'workshop') document.querySelector('[data-page-tab="workshop"]').click();
        for (let i=0; i<50 && !(page === 'library' ? document.querySelector('.ow-library-controls') : document.querySelector('.ow-workshop-controls')); i++) await sleep(50);
        const left = document.querySelector(page === 'library' ? '.ow-library-controls' : '.ow-workshop-controls');
        const right = document.querySelector(page === 'library' ? '.ow-library-sidebar' : '#wallpaper-settings');
        const grid = document.querySelector(page === 'library' ? '.wx-scenery-grid' : '.owb-grid');
        require(left && right && grid, 'missing panel or gallery');
        const search = left.querySelector(page === 'library' ? 'input[type=search]' : '.owb-search input');
        const filters = left.querySelector(page === 'library' ? '.ow-library-filters' : '.owb-filters');
        require(search && filters && left.contains(search) && left.contains(filters), 'controls not grouped');
        search.focus({preventScroll:true});
        require(document.activeElement===search,'search cannot receive focus');
        const searchBounds=search.getBoundingClientRect(),panelBounds=left.getBoundingClientRect(),focusStyle=getComputedStyle(search);
        const focusSpace=Math.max(5,(parseFloat(focusStyle.outlineWidth)||0)+Math.max(0,parseFloat(focusStyle.outlineOffset)||0));
        require(searchBounds.left-panelBounds.left>=focusSpace-1&&panelBounds.right-searchBounds.right>=focusSpace-1,'search focus ring is clipped');
        search.blur();
        if (page === 'workshop') {
          require(left.querySelector('.owb-search').getBoundingClientRect().bottom <= filters.getBoundingClientRect().top+1, 'search overlaps filters');
          const before = window.__browseRequests;
          const select = filters.querySelector('[data-filter=sort]');
          select.value='mostrecent'; select.dispatchEvent(new Event('change',{bubbles:true}));
          await sleep(120);
          require(window.__browseRequests > before, 'filter stopped working after moving');
          const submitted = window.__browseRequests;
          search.value='forest'; left.querySelector('.owb-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          await sleep(120);
          require(window.__browseRequests > submitted, 'search stopped working after moving');
        } else {
          search.value='forest'; search.dispatchEvent(new Event('input',{bubbles:true}));
          require(search.value === 'forest', 'library search unavailable');
          require(left.querySelector('.ow-library-target select').value === 'display-a', 'screen selector unavailable');
          right.querySelector('.wx-wallpaper-adjustments').open=true;
        }
        for (let i=0;i<36;i++) { const item=document.createElement('div');item.style.cssText='height:165px;border-radius:12px;background:#355;';grid.append(item); }
        const extra=document.createElement('div');extra.style.height='1200px';extra.textContent='Long panel contents';(page==='workshop'?document.querySelector('.wx-workshop-body'):right).append(extra);
        await sleep(180);
        const rect = el => {const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom};};
        const positions=[];
        for (const y of [0,20,100,700,1100,1600,100000]) { window.scrollTo(0,y);await sleep(100);positions.push({scroll:window.scrollY,left:rect(left),right:rect(right),search:rect(search),filters:rect(filters)}); }
        require(positions[3].scroll>100, 'gallery did not scroll');
        require(getComputedStyle(left).position==='sticky', 'left panel is not sticky');
        require(getComputedStyle(right).position==='sticky', 'right panel is not sticky');
        for(const p of positions) for(const key of ['left','right','search','filters']) require(Math.abs(positions[0][key].top-p[key].top)<1, key+' moved while scrolling: '+JSON.stringify({positions,body:rect(document.body),main:rect(document.querySelector('main')),picker:rect(document.querySelector('.wx-background-picker')),container:rect(document.querySelector('.wx-background-body'))}));
        if(left.scrollHeight>left.clientHeight+1){left.scrollTop=left.scrollHeight;require(left.scrollTop>0,'long filters cannot scroll');}
        right.scrollTop=right.scrollHeight;require(right.scrollTop>0, 'long details cannot scroll: '+JSON.stringify({height:right.clientHeight,scrollHeight:right.scrollHeight,connected:extra.isConnected}));
        require(left.scrollWidth<=left.clientWidth+1,'left controls overflow horizontally: '+JSON.stringify({width:left.clientWidth,scroll:left.scrollWidth}));
        require(right.scrollWidth<=right.clientWidth+1,'right controls overflow horizontally: '+JSON.stringify({width:right.clientWidth,scroll:right.scrollWidth}));
        if(page==='library') for(const slider of right.querySelectorAll('.wx-wallpaper-adjustments input[type=range]')) {const box=slider.getBoundingClientRect(),container=right.getBoundingClientRect();require(box.left>=container.left-1&&box.right<=container.right+1,'wallpaper slider is clipped');}
        require(positions[0].left.right <= rect(grid).left+1, 'left panel overlaps gallery');
        require(rect(grid).right <= positions[0].right.left+1, 'right panel overlaps gallery');
        if(window.innerWidth>=1600) require(grid.getBoundingClientRect().width>window.innerWidth*0.55,'gallery does not expand with the window');
        require(document.documentElement.scrollWidth <= window.innerWidth+1, 'layout overflows horizontally: '+JSON.stringify({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,grid:getComputedStyle(document.querySelector('main')).gridTemplateColumns,rightPanel:{rect:rect(right),width:getComputedStyle(right).width,min:getComputedStyle(right).minWidth,overflow:getComputedStyle(right).overflow},offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth,min:getComputedStyle(e).minWidth}))}));
        return JSON.stringify({page,width:window.innerWidth,scroll:positions[5].scroll,end:positions[6].scroll,leftTop:positions[6].left.top,rightTop:positions[6].right.top});
        """.replacingOccurrences(of: "PAGE", with: "'\(current.0)'")
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): print("PASS \(self.current.0) \(self.current.1)x\(self.current.2): \(value)")
            case .failure(let error): self.failures += 1; print("FAIL \(self.current.0) \(self.current.1)x\(self.current.2): \(error)")
            }
            self.next()
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failures += 1; print("FAIL loading \(current): \(error)"); next() }
}
let test = Test(endpoint: url)
web.navigationDelegate = test
test.next()
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { print("FAIL: timeout"); exit(1) }
application.run()
