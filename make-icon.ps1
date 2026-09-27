# Cree build\icon.png (512 x 512, carre) a partir de src\logo.png, en gardant le centre de l image.
# C est cette icone qui est mise sur l'exe, le Setup, le bureau et la barre des taches.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = Join-Path $PSScriptRoot 'src\logo.png'
$outDir = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'icon.png'
$img = [System.Drawing.Image]::FromFile($src)
try {
  $side = [Math]::Min($img.Width, $img.Height)
  $x = [int][Math]::Floor(($img.Width - $side) / 2)
  $y = [int][Math]::Floor(($img.Height - $side) / 2)
  $size = 512
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $dest = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $g.DrawImage($img, $dest, $x, $y, $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
} finally { $img.Dispose() }
Write-Host "  Icone creee a partir du centre de ton logo : build\icon.png (512 x 512)"
