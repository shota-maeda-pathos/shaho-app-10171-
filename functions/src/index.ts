import './config';

/**
 * 関数のモジュールは呼ばれたときに読み込む。
 * 実行時は呼ばれた関数のモジュールだけを読み込み、起動を短くする（デプロイ時の関数の検出では全部読み込まれる）。
 */
function lazy(load: () => Record<string, unknown>, names: string[]): void {
  for (const name of names) Object.defineProperty(exports, name, { enumerable: true, get: () => load()[name] });
}

lazy(() => require('./collections/collection-record/functions'), ['collectionRecord']);
lazy(() => require('./operations/functions'), ['operationsMonthlyStatus', 'operationsMonthlyHold', 'operationsMonthlyAction']);
lazy(() => require('./monthly/functions'), [
  'monthlyRunOverview', 'monthlyRunHold', 'monthlySalaryImport', 'monthlySalaryNoPay', 'monthlyCollectionEntry', 'monthlyJobStart', 'monthlyJobGet', 'monthlyJobChunk', 'monthlySalaryItemsUpdate',
]);
lazy(() => require('./procedures/procedure-action/functions'), ['procedureAction']);

// 会社API
lazy(() => require('./companies/company-get/functions'), ['companyGet']);
lazy(() => require('./companies/company-update/functions'), ['companyUpdate']);

// 従業員API
lazy(() => require('./employees/employee-create/functions'), ['employeeCreate']);
lazy(() => require('./employees/employee-onboard/functions'), ['employeeOnboard']);
lazy(() => require('./employees/employee-list/functions'), ['employeeList']);
lazy(() => require('./employees/employee-get/functions'), ['employeeGet']);
lazy(() => require('./employees/employee-update/functions'), ['employeeUpdate']);
lazy(() => require('./employees/employee-delete/functions'), ['employeeDelete']);
lazy(() => require('./employees/employee-transfer/functions'), ['employeeTransfer']);
lazy(() => require('./employees/employee-resign/functions'), ['employeeResign']);
lazy(() => require('./employees/employee-secrets/functions'), ['employeeSecretsGet', 'employeeSecretsUpdate', 'employeeSecretsReveal']);
lazy(() => require('./auth-session/functions'), ['authLogin', 'authGoogleLogin', 'authInvitationGet', 'authInvitationAccept', 'authLogout', 'authSessionList', 'authSessionRevoke', 'authChangePassword', 'authUnlock', 'authInvitationReissue', 'authPing']);

// 組織マスタAPI
lazy(() => require('./offices/office-list/functions'), ['officeList']);
lazy(() => require('./offices/department-list/functions'), ['departmentList']);
lazy(() => require('./offices/departments'), ['departmentSave']);
lazy(() => require('./offices/insurance-rate-list/functions'), ['insuranceRateList']);
lazy(() => require('./offices/office-update/functions'), ['officeUpdate']);
lazy(() => require('./offices/office-create/functions'), ['officeCreate']);
lazy(() => require('./offices/office-abolish/functions'), ['officeAbolish']);

// 雇用API
lazy(() => require('./employments/employment-create/functions'), ['employmentCreate']);

// 等級API
lazy(() => require('./grades/grade-create/functions'), ['gradeCreate']);
lazy(() => require('./grades/grade-update/functions'), ['gradeUpdate']);
lazy(() => require('./grades/outdated'), ['gradeOutdatedMark']);
lazy(() => require('./santei/functions'), [
  'santeiRunOverview', 'santeiRunHold', 'santeiDecision', 'santeiJobStart', 'santeiJobGet', 'santeiJobChunk', 'santeiFilingCreate', 'santeiFilingUpdate', 'santeiFilingGet', 'sampleSanteiCreate',
]);
lazy(() => require('./bonus/functions'), [
  'bonusRunOverview', 'bonusRunHold', 'bonusRunImport', 'bonusRunEntry', 'bonusRunNonPayment', 'bonusJobStart', 'bonusJobGet', 'bonusJobChunk', 'bonusFilingCreate', 'bonusFilingUpdate', 'bonusFilingGet', 'sampleBonusCreate', 'bonusNonPaymentFilingCreate',
]);

// 給与API
lazy(() => require('./salaries/salary-create/functions'), ['salaryCreate']);
lazy(() => require('./salaries/salary-update/functions'), ['salaryUpdate']);
lazy(() => require('./salaries/salary-list/functions'), ['salaryList']);
lazy(() => require('./salaries/salary-csv-import/functions'), ['salaryCsvImport']);
lazy(() => require('./salaries/salary-publish/functions'), ['salaryPublish']);

// 賞与API
lazy(() => require('./bonuses/bonus-create/functions'), ['bonusCreate']);

// 保険料計算API
lazy(() => require('./insurance/monthly-insurance-calculate/functions'), ['monthlyInsuranceCalculate']);
lazy(() => require('./insurance/bonus-insurance-calculate/functions'), ['bonusInsuranceCalculate']);

// 届出API
lazy(() => require('./filings/filing-create/functions'), ['filingCreate']);
lazy(() => require('./filings/filing-submit/functions'), ['filingSubmit']);
lazy(() => require('./filings/filing-list/functions'), ['filingList']);
lazy(() => require('./filings/filing-get/functions'), ['filingGet']);
lazy(() => require('./filings/filing-record-result/functions'), ['filingRecordResult']);

// 承認フローAPI
lazy(() => require('./approvals/approval-request-create/functions'), ['approvalRequestCreate']);
lazy(() => require('./approvals/approval-request-approve/functions'), ['approvalRequestApprove']);
lazy(() => require('./approvals/approval-request-reject/functions'), ['approvalRequestReject']);
lazy(() => require('./approvals/approval-request-list/functions'), ['approvalRequestList']);

// ユーザー管理API
lazy(() => require('./users/user-invite/functions'), ['userInvite']);
lazy(() => require('./users/user-update-role/functions'), ['userUpdateRole']);
lazy(() => require('./users/user-list/functions'), ['userList']);
lazy(() => require('./users/user-suspend/functions'), ['userSuspend', 'userUnsuspend', 'userDisableLogin']);

// 招待API
lazy(() => require('./users/invitation-list/functions'), ['invitationList']);

// 監査ログAPI
lazy(() => require('./audit/audit-log-list/functions'), ['auditLogList', 'auditLogExport', 'auditLogVerify']);
lazy(() => require('./audit/seal'), ['auditLogSeal']);

// ダッシュボードAPI
lazy(() => require('./dashboard/dashboard-stats/functions'), ['dashboardStats']);
lazy(() => require('./dashboard/dashboard-analytics/functions'), ['dashboardAnalytics']);
lazy(() => require('./dashboard/summary/functions'), ['dashboardSummary', 'dashboardSummaryRefresh', 'dashboardSummaryDaily']);
lazy(() => require('./dashboard/calendar/functions'), ['calendarGet', 'checklistGet', 'checklistSet', 'reminderSettingsUpdate']);
lazy(() => require('./dashboard/cost-analysis/functions'), ['costAnalysis']);
lazy(() => require('./simulation/functions'), ['simulationRaise', 'simulationHire', 'simulationAnnual', 'simulationRateChange', 'simulationBonus']);
lazy(() => require('./reports/functions'), ['reportData']);
lazy(() => require('./insurance-rates/functions'), ['rateImportPreview', 'rateImportApply', 'rateUnionAdd', 'rateHistoryList', 'gradeTableGet']);

// エクスポートAPI
lazy(() => require('./exports/employee-export/functions'), ['employeeExport']);

// 休業管理API
lazy(() => require('./leaves/leave-create/functions'), ['leaveCreate']);
lazy(() => require('./leaves/leave-list/functions'), ['leaveList']);

// 保険料免除API
lazy(() => require('./exemptions/premium-exemption-create/functions'), ['premiumExemptionCreate']);
lazy(() => require('./exemptions/premium-exemption-list/functions'), ['premiumExemptionList']);

// 扶養家族API
lazy(() => require('./dependents/dependent-create/functions'), ['dependentCreate']);
lazy(() => require('./dependents/dependent-list/functions'), ['dependentList']);
lazy(() => require('./dependents/dependent-get/functions'), ['dependentGet']);
lazy(() => require('./dependents/dependent-update/functions'), ['dependentUpdate']);
lazy(() => require('./dependents/dependent-delete/functions'), ['dependentDelete']);

lazy(() => require('./insurance/monthly-insurance-get/functions'), ['monthlyInsuranceGet']);

lazy(() => require('./samples/tigers/functions'), ['sampleTigersCreate', 'tigersRegister']);
lazy(() => require('./samples/load/functions'), ['sampleLoadCreate']);

lazy(() => require('./employees/employee-history-list/functions'), ['employeeHistoryList']);

lazy(() => require('./leaves/leave-update/functions'), ['leaveUpdate']);
lazy(() => require('./exemptions/premium-exemption-update/functions'), ['premiumExemptionUpdate']);

lazy(() => require('./portal/functions'), ['portalOverview', 'portalPayslipGet', 'portalDetails', 'portalSettingsGet', 'portalSettingsUpdate', 'portalRequestCreate', 'portalRequestAttach', 'portalRequestMine', 'portalRequestList', 'portalRequestAttachmentGet', 'portalRequestHandle']);
lazy(() => require('./bonuses/workflow/functions'), ['bonusGet', 'bonusUpdate']);

// 届出自動生成・模擬申請・PDF
lazy(() => require('./filings/filing-auto-generate/functions'), ['filingAutoGenerate']);
lazy(() => require('./filings/filing-mock-submit/functions'), ['filingMockSubmit']);
lazy(() => require('./filings/filing-pdf-data/functions'), ['filingPdfData']);
lazy(() => require('./filings/index/functions'), [
  'filingIndexEmployee', 'filingIndexSantei', 'filingIndexBonus', 'filingSearch', 'filingIndexRebuild',
]);
lazy(() => require('./filings/submission/functions'), ['filingSubmissionGet', 'filingSubmissionAction', 'filingMockSettings', 'filingMockAdvance']);
lazy(() => require('./filings/correction/functions'), ['filingCorrectionCreate', 'filingCorrectionUpdate']);
lazy(() => require('./filings/attachments/functions'), ['filingAttachmentList', 'filingAttachmentUpload', 'filingAttachmentGet', 'filingAttachmentDelete']);
lazy(() => require('./filings/archive/functions'), ['filingArchiveList', 'filingArchiveGet', 'filingArchiveBatch']);
lazy(() => require('./approvals/index/functions'), [
  'approvalIndexRequest', 'approvalSearch', 'approvalBadgeGet', 'approvalDetailGet', 'approvalBulkApprove', 'approvalCancel', 'approvalSettingsGet', 'approvalIndexRebuild', 'approvalReminder',
]);

// 通知API
lazy(() => require('./notifications/notification-create/functions'), ['notificationCreate']);
lazy(() => require('./notifications/notification-list/functions'), ['notificationList']);
lazy(() => require('./notifications/notification-mark-read/functions'), ['notificationMarkRead']);

// 徴収管理API
lazy(() => require('./collections/collection-create/functions'), ['collectionCreate']);
lazy(() => require('./collections/collection-list/functions'), ['collectionList']);
lazy(() => require('./collections/collection-summary/functions'), ['collectionSummary']);

// シミュレーションAPI
lazy(() => require('./simulation/premium-simulate/functions'), ['premiumSimulate']);

// バッチ処理API
lazy(() => require('./batch/age-event-check/functions'), ['ageEventCheck']);

// 案件（手続き）API
lazy(() => require('./procedures/procedure-create/functions'), ['procedureCreate']);
lazy(() => require('./procedures/procedure-get/functions'), ['procedureGet']);
lazy(() => require('./procedures/procedure-list/functions'), ['procedureList']);
lazy(() => require('./procedures/procedure-update/functions'), ['procedureUpdate']);
lazy(() => require('./procedures/procedure-cancel/functions'), ['procedureCancel']);

// セットアップ
lazy(() => require('./seed/seed-master/functions'), ['seedMasterData']);
lazy(() => require('./seed/seed-grades/functions'), ['seedGrades']);
lazy(() => require('./migrations/rounding-rule'), ['migrateOfficeRoundingRule']);
lazy(() => require('./migrations/rate-repair'), ['migrateInsuranceRates']);
lazy(() => require('./onboarding/functions'), [
  'onboardingStart', 'onboardingGet', 'onboardingList', 'onboardingPreview', 'onboardingUpdate', 'onboardInviteGet', 'onboardInviteSubmit',
]);
lazy(() => require('./home/functions'), ['homeTodos', 'homeBulkTodo']);
lazy(() => require('./resignation/functions'), ['resignationStart', 'resignationGet', 'resignationPreview', 'resignationUpdate']);
lazy(() => require('./dependent-change/functions'), [
  'dependentChangeStart', 'dependentChangeGet', 'dependentChangePreview', 'dependentChangeUpdate',
]);
lazy(() => require('./leave-procedure/functions'), ['leaveProcedureStart', 'leaveProcedureGet', 'leaveProcedurePreview', 'leaveProcedureUpdate']);
lazy(() => require('./grade-revision/functions'), [
  'gradeRevisionStart', 'gradeRevisionGet', 'gradeRevisionPreview', 'gradeRevisionUpdate', 'sampleRevisionCreate',
]);
lazy(() => require('./employment-change/functions'), [
  'employmentChangeStart', 'employmentChangeGet', 'employmentChangePreview', 'employmentChangeUpdate', 'sampleChangeCreate',
]);
lazy(() => require('./transfer/functions'), ['transferStart', 'transferGet', 'transferPreview', 'transferUpdate']);
lazy(() => require('./grade-correction/functions'), ['gradeCorrectionStart', 'gradeCorrectionGet', 'gradeCorrectionPreview', 'gradeCorrectionUpdate']);
lazy(() => require('./employees/employee-other-employer/functions'), ['employeeOtherEmployerSet']);
lazy(() => require('./age-event/functions'), ['ageEventStart', 'ageEventGet', 'ageEventPreview', 'ageEventUpdate', 'sampleAgeCreate']);
lazy(() => require('./procedures/group-list'), ['procedureGroupList']);
lazy(() => require('./procedures/draft'), ['procedureDraftGet', 'procedureDraftSave']);
