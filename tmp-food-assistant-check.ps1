$base='http://127.0.0.1:4173'
$today=Get-Date
$dow=[int]$today.DayOfWeek
$offset = if ($dow -eq 0) { -6 } else { 1 - $dow }
$weekStart=$today.Date.AddDays($offset).ToString('yyyy-MM-dd')

$step1Pass=$false; $step2Pass=$false; $step3Pass=$false; $step4Pass=$false; $step5Pass=$false

try {
  $putBody = @{ weekStart=$weekStart; day='monday'; dishName='Lemon Pasta'; groceryList=@('Pasta','Lemon','Parmesan') } | ConvertTo-Json -Depth 5
  $created = Invoke-RestMethod -Method Put -Uri "$base/api/v1/food-plan" -ContentType 'application/json' -Body $putBody
  $step1Pass=$true
  Write-Output ("STEP1 PASS weekStart={0} day={1} dishName={2} groceryCount={3}" -f $created.weekStart,$created.day,$created.dishName,($created.groceryList | Measure-Object).Count)
} catch {
  $msg=$_.Exception.Message
  Write-Output ("STEP1 FAIL weekStart={0} error={1}" -f $weekStart,$msg)
}

try {
  $fp = Invoke-RestMethod -Method Get -Uri "$base/api/v1/food-plan?weekStart=$weekStart"
  $item = $fp.items | Where-Object { $_.day -eq 'monday' } | Select-Object -First 1
  if ($item) {
    $step2Pass=$true
    Write-Output ("STEP2 PASS weekStart={0} itemDay={1} dishName={2} groceryCount={3}" -f $fp.weekStart,$item.day,$item.dishName,($item.groceryList | Measure-Object).Count)
  } else {
    Write-Output ("STEP2 FAIL weekStart={0} error=No monday item found" -f $weekStart)
  }
} catch {
  Write-Output ("STEP2 FAIL weekStart={0} error={1}" -f $weekStart,$_.Exception.Message)
}

try {
  $del = Invoke-WebRequest -Method Delete -Uri "$base/api/v1/food-plan?weekStart=$weekStart&day=monday"
  $code=[int]$del.StatusCode
  if ($code -eq 204) { $step3Pass=$true; Write-Output ("STEP3 PASS statusCode={0} weekStart={1} day=monday" -f $code,$weekStart) }
  else { Write-Output ("STEP3 FAIL statusCode={0} weekStart={1} day=monday" -f $code,$weekStart) }
} catch {
  $code=$null; if ($_.Exception.Response) { try { $code=[int]$_.Exception.Response.StatusCode } catch {} }
  Write-Output ("STEP3 FAIL statusCode={0} weekStart={1} day=monday error={2}" -f $code,$weekStart,$_.Exception.Message)
}

try {
  $funBody = @{ message='Give me one quick weeknight dinner suggestion for a busy family.' } | ConvertTo-Json
  $fun = Invoke-RestMethod -Method Post -Uri "$base/api/v1/assistant/fun" -ContentType 'application/json' -Body $funBody
  $snippet = if ($fun.response) { $fun.response.Substring(0,[Math]::Min(100,$fun.response.Length)).Replace("`r"," ").Replace("`n"," ") } else { '' }
  $step4Pass=$true
  Write-Output ("STEP4 PASS source={0} responseSnippet={1}" -f $fun.source,$snippet)
} catch {
  Write-Output ("STEP4 FAIL error={0}" -f $_.Exception.Message)
}

try {
  $dash = Invoke-RestMethod -Method Get -Uri "$base/api/v1/dashboard"
  $memberId = $dash.members[0].id
  $calendarId = $dash.calendars[0].id
  $parseBody = @{ message='add task: Pack school bag'; memberId=$memberId; calendarId=$calendarId } | ConvertTo-Json
  $parse = Invoke-RestMethod -Method Post -Uri "$base/api/v1/assistant/parse" -ContentType 'application/json' -Body $parseBody
  $mf = if ($parse.missingFields) { ($parse.missingFields -join ',') } else { '(none)' }
  $step5Pass=$true
  Write-Output ("STEP5 PASS missingFields={0} requiresConfirmation={1} source={2}" -f $mf,$parse.requiresConfirmation,$parse.source)
} catch {
  Write-Output ("STEP5 FAIL error={0}" -f $_.Exception.Message)
}

Write-Output ("RESULT SUMMARY: 1={0} 2={1} 3={2} 4={3} 5={4}" -f $(if($step1Pass){'PASS'}else{'FAIL'}),$(if($step2Pass){'PASS'}else{'FAIL'}),$(if($step3Pass){'PASS'}else{'FAIL'}),$(if($step4Pass){'PASS'}else{'FAIL'}),$(if($step5Pass){'PASS'}else{'FAIL'}))
