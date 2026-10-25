// 用法：swift tools/make-app-icon.swift assets/brand/ai-dtl-logo.png <输出.png>
// 从横版原图裁出左侧“D+书本”图形，不改色不拉伸，居中放到 1024 白底方形上（App 图标不能有透明）。
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let w = image.width, h = image.height
var pixels = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
// 图形和文字之间有一段全透明的列；从左往右找到第一段墨，到下一段空白为止。
func columnHasInk(_ x: Int) -> Bool { (0..<h).contains { pixels[($0 * w + x) * 4 + 3] > 40 } }
var x0 = 0; while x0 < w && !columnHasInk(x0) { x0 += 1 }
var x1 = x0; var gap = 0
while x1 < w { if columnHasInk(x1) { gap = 0 } else { gap += 1; if gap > 20 { break } }; x1 += 1 }
x1 -= gap
var y0 = h, y1 = 0
for y in 0..<h { for x in x0..<x1 where pixels[(y * w + x) * 4 + 3] > 40 { y0 = min(y0, y); y1 = max(y1, y); break } }
// CGContext 的行序自下而上，换回图像坐标裁剪。
let crop = CGRect(x: x0, y: h - 1 - y1, width: x1 - x0, height: y1 - y0 + 1)
print("emblem", crop)
let emblem = image.cropping(to: crop)!
let side = 1024.0, box = side * 0.66
let scale = min(box / Double(emblem.width), box / Double(emblem.height))
let ew = Double(emblem.width) * scale, eh = Double(emblem.height) * scale
let out = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
out.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); out.fill(CGRect(x: 0, y: 0, width: side, height: side))
out.interpolationQuality = .high
out.draw(emblem, in: CGRect(x: (side - ew) / 2, y: (side - eh) / 2, width: ew, height: eh))
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, out.makeImage()!, nil); CGImageDestinationFinalize(dest)
