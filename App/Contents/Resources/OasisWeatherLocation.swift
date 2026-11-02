import Cocoa
import CoreLocation

/// Foreground, kilometre-scale location for weather. No continuous background
/// tracking and no address-level data is sent to the forecast provider.
@MainActor
final class OasisWeatherLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var completions: [([String:Any]) -> Void] = []
    private var timeout: Timer?
    private var resolving = false
    private var generation: UInt64 = 0

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func locate(requestPermission: Bool, completion: @escaping ([String:Any]) -> Void) {
        let status = manager.authorizationStatus
        if status == .denied || status == .restricted {
            completion(["ok":false,"error":"location-denied"]); return
        }
        if status == .notDetermined && !requestPermission {
            completion(["ok":false,"error":"location-permission"]); return
        }
        completions.append(completion)
        guard completions.count == 1 else { return }
        generation &+= 1
        timeout = Timer.scheduledTimer(withTimeInterval:45,repeats:false) { [weak self] _ in
            Task { @MainActor in self?.finish(["ok":false,"error":"location-timeout"]) }
        }
        if status == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { manager.requestLocation() }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !completions.isEmpty else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        case .denied, .restricted: finish(["ok":false,"error":"location-denied"])
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !completions.isEmpty, !resolving,
              let location=locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) < 900 else { return }
        resolving = true
        let requestGeneration=generation
        let base:[String:Any] = ["latitude":(location.coordinate.latitude*1000).rounded()/1000,
                               "longitude":(location.coordinate.longitude*1000).rounded()/1000,
                               "mode":"current","name":"目前位置"]
        geocoder.reverseGeocodeLocation(location,preferredLocale:Locale(identifier:MoleLanguage.current)) { [weak self] places, _ in
            Task { @MainActor in
                guard let self, self.generation == requestGeneration, self.resolving else { return }
                var value=base
                if let place=places?.first {
                    value["name"]=place.locality ?? place.subAdministrativeArea ?? place.administrativeArea ?? "目前位置"
                    value["region"]=place.administrativeArea ?? ""
                    value["country"]=place.country ?? ""
                }
                self.finish(["ok":true,"location":value])
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard !completions.isEmpty else { return }
        finish(["ok":false,"error":(error as? CLError)?.code == .denied ? "location-denied":"location-unavailable"])
    }

    private func finish(_ result:[String:Any]) {
        timeout?.invalidate();timeout=nil;manager.stopUpdatingLocation();geocoder.cancelGeocode();resolving=false
        generation &+= 1
        let callbacks=completions;completions.removeAll();callbacks.forEach{$0(result)}
    }
}
