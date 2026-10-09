# Lance le quiz sous Windows : télécharge PocketBase (version fixée dans
# VERSION, empreinte vérifiée) si besoin, crée le compte admin décrit dans
# .env, puis démarre le serveur. La base et les fichiers vont dans pb_data\.
#
#   powershell -ExecutionPolicy Bypass -File demarrer.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Version = (Get-Content VERSION -Raw).Trim()
$Archi = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$Exe = Join-Path $PSScriptRoot "pocketbase.exe"

function Installer-PocketBase {
    $archive = "pocketbase_${Version}_windows_${Archi}.zip"
    $url = "https://github.com/pocketbase/pocketbase/releases/download/v$Version"
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
    New-Item -ItemType Directory $temp | Out-Null
    try {
        Write-Host "Téléchargement de PocketBase $Version (windows/$Archi)..."
        Invoke-WebRequest "$url/$archive" -OutFile "$temp\$archive" -UseBasicParsing
        Invoke-WebRequest "$url/checksums.txt" -OutFile "$temp\checksums.txt" -UseBasicParsing

        $ligne = Select-String -Path "$temp\checksums.txt" -Pattern " $([regex]::Escape($archive))$"
        $attendue = if ($ligne) { ($ligne.Line -split "\s+")[0] } else { "" }
        $obtenue = (Get-FileHash "$temp\$archive" -Algorithm SHA256).Hash.ToLower()
        if (-not $attendue -or $attendue -ne $obtenue) {
            throw "Empreinte invalide pour $archive : téléchargement corrompu ou modifié."
        }
        Expand-Archive "$temp\$archive" -DestinationPath "$temp\extrait" -Force
        Copy-Item "$temp\extrait\pocketbase.exe" $Exe -Force
    }
    finally {
        Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$installee = if (Test-Path $Exe) { ((& $Exe --version) -split " ")[2] } else { "" }
if ($installee -ne $Version) { Installer-PocketBase }

# Lecture de .env (lignes NOM=valeur, # pour les commentaires).
if (Test-Path .env) {
    foreach ($ligne in Get-Content .env) {
        if ($ligne -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
        }
    }
}

if ($env:ADMIN_EMAIL -and $env:ADMIN_PASSWORD) {
    # Applique d'abord les migrations : la base doit exister pour y créer le compte.
    & $Exe migrate up --dir pb_data --migrationsDir pb_migrations --hooksDir pb_hooks | Out-Null
    & $Exe superuser upsert $env:ADMIN_EMAIL $env:ADMIN_PASSWORD --dir pb_data
}

$adresse = if ($env:PB_HTTP) { $env:PB_HTTP } else { "127.0.0.1:8090" }
# --indexFallback=false : une adresse inconnue répond 404 au lieu de la page d'accueil.
$options = @("serve", "--dir", "pb_data", "--hooksDir", "pb_hooks", "--migrationsDir", "pb_migrations",
             "--publicDir", "pb_public", "--indexFallback=false", "--http", $adresse)
if ($env:PB_ORIGINS) { $options += @("--origins", $env:PB_ORIGINS) }

Write-Host "Site : http://$adresse   Tableau de bord : http://$adresse/_/"
& $Exe @options
