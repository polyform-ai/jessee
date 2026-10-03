import AVFoundation
import Accelerate
import Foundation

/// Reads the actual PCM representation, including interleaved and integer input devices.
public enum AudioSignal {
  public static func rms(in buffer: CMSampleBuffer) -> Double? {
    guard buffer.isValid,
      let format = buffer.formatDescription?.audioStreamBasicDescription,
      format.mFormatID == kAudioFormatLinearPCM
    else { return nil }
    var sum: Double = 0
    var count = 0
    try? buffer.withAudioBufferList { list, _ in
      for item in list {
        guard let data = item.mData else { continue }
        if format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 {
          let length = Int(item.mDataByteSize) / MemoryLayout<Float>.size
          guard length > 0 else { continue }
          var mean: Float = 0
          vDSP_measqv(data.assumingMemoryBound(to: Float.self), 1, &mean, vDSP_Length(length))
          sum += Double(mean) * Double(length)
          count += length
        } else if format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 64 {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Double.self),
            count: Int(item.mDataByteSize) / MemoryLayout<Double>.size)
          for sample in values { sum += sample * sample }
          count += values.count
        } else if format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0 {
          let bits = Int(format.mBitsPerChannel)
          let channels = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
            ? 1 : Int(format.mChannelsPerFrame)
          guard channels > 0 else { continue }
          let bytes = Int(format.mBytesPerFrame) / channels
          guard (1...4).contains(bytes), (1...32).contains(bits), bits <= bytes * 8 else { continue }
          let length = Int(item.mDataByteSize) / bytes
          let pointer = data.assumingMemoryBound(to: UInt8.self)
          let bigEndian = format.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
          let alignedHigh = format.mFormatFlags & kAudioFormatFlagIsAlignedHigh != 0
          let mask = (UInt64(1) << bits) - 1
          let sign = UInt64(1) << (bits - 1)
          for index in 0..<length {
            var raw: UInt64 = 0
            for byte in 0..<bytes {
              let shift = (bigEndian ? bytes - 1 - byte : byte) * 8
              raw |= UInt64(pointer[index * bytes + byte]) << shift
            }
            if alignedHigh { raw >>= bytes * 8 - bits }
            raw &= mask
            let signed = raw & sign == 0 ? Int64(raw) : Int64(raw) - Int64(mask + 1)
            let sample = Double(signed) / Double(sign)
            sum += sample * sample
          }
          count += length
        }
      }
    }
    guard count > 0, sum.isFinite else { return nil }
    return sqrt(sum / Double(count))
  }

  /// Reject a silent *track*, not just a missing track, before any paid AI request.
  public static func requireSignal(in url: URL) async throws {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw JesSeeError.mediaHasNoAudio
    }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsNonInterleaved: false,
      ])
    reader.add(output)
    guard reader.startReading() else {
      throw reader.error ?? JesSeeError.invalidResponse("JesSee could not check the audio.")
    }
    defer { reader.cancelReading() }
    while let buffer = output.copyNextSampleBuffer() {
      try Task.checkCancellation()
      // A very low floor rejects digital silence without discarding softly spoken narration.
      if let level = rms(in: buffer), level > 0.00001 { return }
    }
    if reader.status == .failed {
      throw reader.error ?? JesSeeError.invalidResponse("JesSee could not read the audio.")
    }
    throw JesSeeError.mediaHasSilentAudio
  }
}
