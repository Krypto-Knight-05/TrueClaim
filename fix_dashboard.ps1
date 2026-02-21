# Delete lines 880 to 979 (1-indexed) from dashboard/page.tsx
# Keep lines 1..879 and 980..end
$f = 'src\app\dashboard\page.tsx'
$lines = Get-Content $f -Encoding UTF8
# PowerShell arrays are 0-indexed; line 880 = index 879, line 979 = index 978
$keep = $lines[0..878] + $lines[979..($lines.Length - 1)]
[System.IO.File]::WriteAllLines((Resolve-Path $f), $keep, [System.Text.Encoding]::UTF8)
Write-Host "Done. Total lines: $($keep.Length)"
