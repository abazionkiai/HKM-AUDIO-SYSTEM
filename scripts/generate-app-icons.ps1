Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Background: Squircle with deep midnight studio slate gradient
$p1 = New-Object System.Drawing.Point 0, 0
$p2 = New-Object System.Drawing.Point 0, $size
$c1 = [System.Drawing.Color]::FromArgb(255, 15, 23, 42)
$c2 = [System.Drawing.Color]::FromArgb(255, 3, 7, 18)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $c1, $c2

$radius = 110
$d = $radius * 2
$pad = 20
$w = $size - ($pad * 2)
$h = $size - ($pad * 2)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($pad, $pad, $d, $d, 180, 90)
$path.AddArc(($pad + $w - $d), $pad, $d, $d, 270, 90)
$path.AddArc(($pad + $w - $d), ($pad + $h - $d), $d, $d, 0, 90)
$path.AddArc($pad, ($pad + $h - $d), $d, $d, 90, 90)
$path.CloseFigure()

$g.FillPath($bgBrush, $path)

# Subtle cyan glowing outline
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 56, 189, 248)), 10.0
$g.DrawPath($borderPen, $path)
$borderPen.Dispose()

# Accent Gradient: Cyber Cyan to Acoustic Emerald
$ap1 = New-Object System.Drawing.Point 0, 100
$ap2 = New-Object System.Drawing.Point 0, 420
$ac1 = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)
$ac2 = [System.Drawing.Color]::FromArgb(255, 16, 185, 129)
$accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $ap1, $ap2, $ac1, $ac2

# Center Cathedral Acoustic Cross & EQ Spectrum Waveform
# Vertical beam
$vPen = New-Object System.Drawing.Pen $accentBrush, 36.0
$vPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$vPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($vPen, 256.0, 120.0, 256.0, 390.0)

# Horizontal beam
$hPen = New-Object System.Drawing.Pen $accentBrush, 32.0
$hPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$hPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($hPen, 140.0, 210.0, 372.0, 210.0)

# EQ Spectrum bars radiating from both sides
# Left side EQ bars (Cyan tones)
$leftBars = @(
    @{ X = 186.0; Y1 = 175.0; Y2 = 330.0; Alpha = 220; W = 18.0 },
    @{ X = 135.0; Y1 = 200.0; Y2 = 305.0; Alpha = 180; W = 16.0 },
    @{ X = 90.0;  Y1 = 225.0; Y2 = 280.0; Alpha = 140; W = 14.0 }
)
foreach ($b in $leftBars) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($b.Alpha, 56, 189, 248)), $b.W
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, [float]$b.X, [float]$b.Y1, [float]$b.X, [float]$b.Y2)
    $pen.Dispose()
}

# Right side EQ bars (Emerald tones)
$rightBars = @(
    @{ X = 326.0; Y1 = 175.0; Y2 = 330.0; Alpha = 220; W = 18.0 },
    @{ X = 377.0; Y1 = 200.0; Y2 = 305.0; Alpha = 180; W = 16.0 },
    @{ X = 422.0; Y1 = 225.0; Y2 = 280.0; Alpha = 140; W = 14.0 }
)
foreach ($b in $rightBars) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($b.Alpha, 16, 185, 129)), $b.W
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, [float]$b.X, [float]$b.Y1, [float]$b.X, [float]$b.Y2)
    $pen.Dispose()
}

# Upper acoustic arch
$archPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(190, 56, 189, 248)), 14.0
$archPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$archPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($archPen, 76.0, 70.0, 360.0, 340.0, 205.0, 130.0)
$archPen.Dispose()

# Lower acoustic arch
$archPen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(160, 16, 185, 129)), 12.0
$archPen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$archPen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($archPen2, 96.0, 105.0, 320.0, 320.0, 25.0, 130.0)
$archPen2.Dispose()

$vPen.Dispose()
$hPen.Dispose()
$bgBrush.Dispose()
$accentBrush.Dispose()
$g.Dispose()

# Save PNGs
$bmp.Save("src-tauri\icons\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
if (-not (Test-Path "public")) { New-Item -ItemType Directory -Path "public" | Out-Null }
$bmp.Save("public\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save("public\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)

$icon192 = New-Object System.Drawing.Bitmap $bmp, 192, 192
$icon192.Save("public\icon-192.png", [System.Drawing.Imaging.ImageFormat]::Png)

$iconH = $bmp.GetHicon()
$ico = [System.Drawing.Icon]::FromHandle($iconH)
$stream = [System.IO.File]::OpenWrite("src-tauri\icons\icon.ico")
$ico.Save($stream)
$stream.Close()
$stream.Dispose()
$ico.Dispose()
$icon192.Dispose()
$bmp.Dispose()

Write-Output "ICONS_GENERATED_OK"
