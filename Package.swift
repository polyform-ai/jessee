// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "JesSee",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "JesSeeCore", targets: ["JesSeeCore"]),
    .executable(name: "JesSeeApp", targets: ["JesSeeApp"]),
  ],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.7.0"),
  ],
  targets: [
    .target(
      name: "JesSeeCore",
      path: "mac/Sources/JesSeeCore",
      linkerSettings: [
        .linkedFramework("AppKit"),
        .linkedFramework("AVFoundation"),
        .linkedFramework("Security"),
      ]
    ),
    .executableTarget(
      name: "JesSeeApp",
      dependencies: [
        "JesSeeCore",
        .product(name: "Sparkle", package: "Sparkle"),
      ],
      path: "mac/Sources/JesSeeApp",
      linkerSettings: [
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("UserNotifications"),
      ]
    ),
    .testTarget(
      name: "JesSeeCoreTests",
      dependencies: ["JesSeeCore"],
      path: "mac/Tests/JesSeeCoreTests"
    ),
  ]
)
