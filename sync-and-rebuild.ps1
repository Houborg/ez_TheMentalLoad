#!/usr/bin/env pwsh
# Quick sync and rebuild script for ez_TheMentalLoad
# Usage: .\sync-and-rebuild.ps1 -Host 192.168.1.252 -User mhouborg

param(
    [string]$Host = "192.168.1.252",
    [string]$User = "mhouborg",
    [string]$Password = "mentalload"
)

$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

Write-Host "🚀 Syncing ez_TheMentalLoad to $Host..." -ForegroundColor Green

# Create SSH command function
function Invoke-RemoteCommand {
    param([string]$Command)
    # Use SSH with known host key acceptance
    ssh -o StrictHostKeyChecking=accept-new "${User}@${Host}" $Command
}

# Get the login files locally
$loginPageContent = Get-Content "packages/frontend/app/login/page.tsx" -Raw
$loginFormContent = Get-Content "packages/frontend/components/login-form.tsx" -Raw
$loginRouteContent = Get-Content "packages/frontend/app/api/auth/login/route.ts" -Raw

Write-Host "📦 Transferring login files..." -ForegroundColor Blue

# Transfer login page
Write-Host "  → Transferring page.tsx..."
scp -o StrictHostKeyChecking=accept-new "packages/frontend/app/login/page.tsx" "${User}@${Host}:~/ez_TheMentalLoad/packages/frontend/app/login/page.tsx"

# Transfer login form component
Write-Host "  → Transferring login-form.tsx..."
scp -o StrictHostKeyChecking=accept-new "packages/frontend/components/login-form.tsx" "${User}@${Host}:~/ez_TheMentalLoad/packages/frontend/components/login-form.tsx"

# Transfer login route
Write-Host "  → Transferring route.ts..."
scp -o StrictHostKeyChecking=accept-new "packages/frontend/app/api/auth/login/route.ts" "${User}@${Host}:~/ez_TheMentalLoad/packages/frontend/app/api/auth/login/route.ts"

# Transfer webhook update
Write-Host "  → Transferring update-webhook.py..."
scp -o StrictHostKeyChecking=accept-new "deploy/update-webhook.py" "${User}@${Host}:~/ez_TheMentalLoad/deploy/update-webhook.py"

Write-Host "🔨 Rebuilding and restarting deployment..." -ForegroundColor Blue
Invoke-RemoteCommand "cd ~/ez_TheMentalLoad && chmod +x deploy/deploy.sh && ./deploy/deploy.sh"

Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Test the deployment:"
Write-Host "  curl -H 'Host: mentalload.pl0k.online' http://${Host}/"
Write-Host "  curl -H 'Host: mentalload.pl0k.online' http://${Host}/login"
Write-Host "  curl http://${Host}:3100/api/v1/health"
