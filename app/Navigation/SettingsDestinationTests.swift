import Testing

@testable import Pico

@Suite("proposal.0005 sidebar destinations")
struct SettingsDestinationTests {
    @Test("the sidebar groups list every destination exactly once")
    func groupsCoverEveryDestinationOnce() {
        let grouped = SettingsDestination.sidebarGroups.flatMap(\.self)

        #expect(grouped.count == SettingsDestination.allCases.count)
        #expect(Set(grouped) == Set(SettingsDestination.allCases))
    }

    @Test("locations follow the sidebar's visible order")
    func locationsFollowSidebarGroups() {
        let destinations = SettingsLocation.allInSidebarOrder.compactMap { location in
            if case .destination(let destination) = location { destination } else { nil }
        }

        #expect(destinations == SettingsDestination.sidebarGroups.flatMap(\.self))
    }
}
