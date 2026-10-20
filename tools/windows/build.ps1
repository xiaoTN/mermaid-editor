param([switch]$CopyToDesktop)
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))
try {
    pnpm --filter playground build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
    Copy-Item apps/playground/dist/index.html cmd/mermaid-editor/index.html -Force
    $env:GOTOOLCHAIN = 'go1.24.4'
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    New-Item -ItemType Directory dist -Force | Out-Null
    go build -trimpath -ldflags '-s -w -H windowsgui' -o dist/mermaid-editor.exe ./cmd/mermaid-editor
    if ($LASTEXITCODE -ne 0) { throw 'Windows 程序构建失败' }
    go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go 静态检查失败' }
    go test ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go 测试失败' }
    $artifact = Get-Item dist/mermaid-editor.exe
    Write-Output ("已生成：{0}（{1} 字节）" -f $artifact.FullName, $artifact.Length)
    if ($CopyToDesktop) {
        $destination = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mermaid编辑器.exe'
        Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
        Write-Output ("已复制到桌面：{0}" -f $destination)
    }
} finally { Pop-Location }
