# RescueCity - kleiner lokaler Webserver (nur auf diesem PC erreichbar)
$port = 8080
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  Write-Host "Port $port ist belegt. Laeuft RescueCity schon? Dann einfach http://localhost:$port/ im Browser oeffnen."
  Start-Process "http://localhost:$port/"
  Read-Host "Enter druecken zum Schliessen"
  exit
}
Start-Process "http://localhost:$port/"
Write-Host "RescueCity laeuft auf http://localhost:$port/"
Write-Host "Dieses Fenster offen lassen, solange du spielst. Zum Beenden einfach schliessen."
$types = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"; ".png" = "image/png"; ".svg" = "image/svg+xml"
  ".json" = "application/json"; ".md" = "text/plain; charset=utf-8"; ".ico" = "image/x-icon"
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($rel -eq '') { $rel = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] } else { $ctx.Response.ContentType = "application/octet-stream" }
    $ctx.Response.Headers.Add("Cache-Control", "no-cache")
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
