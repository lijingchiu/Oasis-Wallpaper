import Foundation

/// The web views and native controls share one catalog and one saved language.
enum MoleLanguage {
    static let key = "moleLanguageV1"
    static let supported = ["zh-TW", "en", "ja"]
    static var current: String { let value = UserDefaults.standard.string(forKey:key) ?? "zh-TW"; return supported.contains(value) ? value : "zh-TW" }
    static func set(_ value: String) { guard supported.contains(value) else { return }; UserDefaults.standard.set(value,forKey:key) }
    static let catalog: [[String]] = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("MoleLocalization.json"), let data = try? Data(contentsOf:url), let rows = try? JSONDecoder().decode([[String]].self,from:data) else { return [] }
        return rows.filter { $0.count == 3 }
    }()
    private static let cache: NSCache<NSString, NSString> = { let cache = NSCache<NSString, NSString>(); cache.countLimit = 512; return cache }()
    static func text(_ source: String) -> String {
        let language = current, key = (language + "\0" + source) as NSString
        if let value = cache.object(forKey:key) { return value as String }
        let value = brand(translate(source,language:language,rows:catalog), language:language)
        cache.setObject(value as NSString,forKey:key); return value
    }
    static func brand(_ source:String,language:String=current)->String {
        if source.hasPrefix("/") || source.hasPrefix("~/") || source.hasPrefix("https://") || source.hasPrefix("http://") || source.range(of:"[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}",options:.regularExpression) != nil{return source}
        let terms = language=="en" ? ["maintenance engine","market data","soundscape library","usage engine"] : language=="ja" ? ["メンテナンスエンジン","相場データ","サウンドスケープ","使用量エンジン"] : ["維護引擎","行情來源","聲景庫","用量引擎"]
        var value=source.replacingOccurrences(of:"移除 Mole",with:"移除維護引擎").replacingOccurrences(of:"更新 Mole",with:"更新維護引擎").replacingOccurrences(of:"目前 Mole 版本",with:"目前維護引擎版本")
        for (pattern,replacement) in [("(?:Remove|Uninstall) Mole\\b","Remove maintenance engine"),("Update Mole\\b","Update maintenance engine"),("Mole version","maintenance engine version"),("Mole CLI\\b",terms[0]),("(?i)Yahoo(?:!|奇摩股市)?(?:\\s*Finance)?",terms[1]),("(?i)(?<![A-Za-z0-9_])myNoise(?![A-Za-z0-9_])",terms[2]),("\\bFocast\\b",terms[2]),("\\bCodexBar\\b",terms[3]),("(?<![A-Za-z0-9_])Mole(?: GUI)?(?![A-Za-z0-9_])","Oasis")] {value=value.replacingOccurrences(of:pattern,with:replacement,options:.regularExpression)}
        return value
    }
    static func translate(_ source: String, language: String, rows: [[String]], depth: Int = 0) -> String {
        guard language != "zh-TW", supported.contains(language), depth < 6 else { return source }
        let column = language == "ja" ? 2 : 1, trimmed = source.trimmingCharacters(in:.whitespacesAndNewlines)
        if let row = rows.first(where: { $0.count == 3 && $0[0] == trimmed && !$0[0].contains("{0}") }) { return source.replacingOccurrences(of:trimmed,with:row[column]) }
        let slotRegex = try! NSRegularExpression(pattern:"\\{([0-9]+)\\}")
        for row in rows where row.count == 3 && row[0].contains("{0}") {
            let slots = slotRegex.matches(in:row[0],range:NSRange(row[0].startIndex...,in:row[0]))
            var pattern = "^", last = row[0].startIndex
            for slot in slots { guard let range = Range(slot.range,in:row[0]) else { continue }; pattern += NSRegularExpression.escapedPattern(for:String(row[0][last..<range.lowerBound])) + "([\\s\\S]*?)"; last = range.upperBound }
            pattern += NSRegularExpression.escapedPattern(for:String(row[0][last...])) + "$"
            guard let regex = try? NSRegularExpression(pattern:pattern), let match = regex.firstMatch(in:trimmed,range:NSRange(trimmed.startIndex...,in:trimmed)) else { continue }
            var result = row[column]
            for (index,slot) in slots.enumerated() { guard let number = Range(slot.range(at:1),in:row[0]), let range = Range(match.range(at:index+1),in:trimmed) else { continue }; let raw = String(trimmed[range]); let value = ["{0}後重設","還有 {0}","{0}主題插畫"].contains(row[0]) ? translate(raw,language:language,rows:rows,depth:depth+1) : raw; result = result.replacingOccurrences(of:"{"+row[0][number]+"}",with:value) }
            return source.replacingOccurrences(of:trimmed,with:result)
        }
        for separator in [" · ","\n","："] where source.contains(separator) { return source.components(separatedBy:separator).map { translate($0,language:language,rows:rows,depth:depth+1) }.joined(separator:separator) }
        return source
    }
}
