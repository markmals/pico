/// The version of the `pico` command Pico runs and of the Oh My Pi engine it carries, which are
/// released separately. Both come from that command's `version get`.
struct InstalledVersions: Decodable, Equatable, Sendable {
    let pico: String
    let omp: String
}
