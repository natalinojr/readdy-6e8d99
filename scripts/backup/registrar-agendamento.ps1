# Registra a tarefa diária de backup do ERPOS no Agendador de Tarefas do Windows.
# O AGENTE NÃO EXECUTA ESTE SCRIPT — é o dono quem roda, na própria máquina,
# quando decidir ativar o backup automático.
#
# Uso (PowerShell, como o usuário dono, não precisa ser admin):
#   cd "D:\dev\ERPOS V2 - claude"
#   powershell -ExecutionPolicy Bypass -File .\scripts\backup\registrar-agendamento.ps1
#
# Parâmetros opcionais:
#   -Time "03:30"           horário local de Brasília (padrão 03:30)
#   -TaskName "ERPOS Backup Diario"
#   -RepoRoot (padrão: pasta do repositório, calculada a partir deste arquivo)

param(
  [string]$Time = "03:30",
  [string]$TaskName = "ERPOS Backup Diario",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
  Write-Error "node não encontrado no PATH. Instale o Node.js ou ajuste este script."
  exit 1
}

$BackupScript = Join-Path $RepoRoot "scripts\backup-diario.mjs"

# backup-diario.mjs já faz, em sequência, tudo que a tarefa precisa:
#  1) extrai todas as tabelas e grava o manifest;
#  2) verifica a integridade (verifyBackupDir) ANTES de promover a pasta do dia;
#  3) só se promovido ("complete") roda a limpeza de retenção (cleanup).
# Por isso a tarefa agendada só precisa chamar este único script; não há
# necessidade de descobrir "qual foi a pasta de hoje" à parte.
$WrapperPs1 = Join-Path $RepoRoot "scripts\backup\_tarefa-agendada.ps1"
$WrapperContent = "& '$NodeExe' '$BackupScript' *>&1 | Out-Null; exit `$LASTEXITCODE"
Set-Content -Path $WrapperPs1 -Value $WrapperContent -Encoding UTF8

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WrapperPs1`""
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Backup diario do banco ERPOS (schema public, sem Docker) + limpeza de retencao + verificacao." -Force

Write-Host "Tarefa '$TaskName' registrada para rodar todo dia às $Time (horário local da máquina)."
Write-Host "Para conferir: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "Para remover:  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
