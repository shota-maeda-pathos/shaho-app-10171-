# 画面構成リストラクチャリング改修計画（v2）

> v1からの主要変更: 進捗の実データ連動、非線形ステップ、定例業務と集計の分離、
> 入社前・バッチ案件・異動への対応、カタログ準拠の修正、縦割り実装順

---

## 1. 現状の正確な棚卸し

### 現在のサイドバー（12項目）
```
ダッシュボード / 従業員 / 届出 / 承認 / 給与 / 保険料 / 賞与保険料 / 徴収 / 算定 / シミュレーション / マイポータル / 設定
```

### 現在のルート構成（app.routes.ts — 実測）
| パス | 画面 | 実装済みの機能 |
|------|------|----------------|
| `/dashboard` | ダッシュボード | 統計カード4種、業務アラート（届出期限超過・未徴収・随時改定候補）、今月のタスク4項目、クイック操作7ボタン、保険料推移テーブル、届出ステータス集計、来月予測、最近の届出一覧 |
| `/employees` | 従業員一覧 | テーブル、CSVインポートダイアログ |
| `/employees/:id` | 従業員詳細 | **入社オンボーディングステッパー**（従業員+雇用+給与+等級+届出を一括作成）、**退職パネル**（退職日・理由→資格喪失届自動生成）、**異動パネル**（異動先事業所・日付・理由）、タブ: 基本情報/扶養/雇用/給与/賞与/等級/届出/休業/免除 |
| `/employees/:id/grade` | 等級決定 | |
| `/employees/:id/revision` | 随時改定 | |
| `/salary` | 給与一覧→編集 | CSVインポート、確認ダイアログ付き保存 |
| `/premium/monthly` | 月額保険料計算 | ステッパー（計算→確認→確定） |
| `/premium/bonus` | 賞与保険料 | |
| `/premium/collection` | 徴収管理 | |
| `/filings` | 届出一覧→詳細 | 自動生成、模擬電子申請、PDF |
| `/approvals` | 承認一覧 | 承認/却下、別担当者ルール |
| `/santei` | 算定一覧→詳細 | |
| `/simulation` | シミュレーション | 事業所・報酬・年齢→保険料試算 |
| `/portal` | マイポータル | 明細一覧→詳細（portalGuard） |
| `/settings` | 設定 | admin限定 |
| `/onboard/:token` | 入社フォーム | 招待トークン→フォーム→確認→完了 |
| `/login` | ログイン | タイムアウトメッセージ対応 |
| `/suspended` | アカウント停止 | |

### 現在のCloud Functions API（68エンドポイント — 実測）
```
会社(2): companyGet, companyUpdate
従業員(8): employeeCreate, employeeOnboard, employeeList, employeeGet,
           employeeUpdate, employeeDelete, employeeTransfer, employeeResign
従業員補助(2): employeeSecretsGet, employeeSecretsUpdate
組織(5): officeList, officeCreate, officeUpdate, departmentList, insuranceRateList
雇用(1): employmentCreate
等級(3): gradeCreate, gradeUpdate, gradeRevisionCheck
給与(5): salaryCreate, salaryUpdate, salaryList, salaryCsvImport, salaryPublish
賞与(3): bonusCreate, bonusGet, bonusUpdate
保険料(3): monthlyInsuranceCalculate, bonusInsuranceCalculate, monthlyInsuranceGet
届出(6): filingCreate, filingSubmit, filingList, filingGet, filingRecordResult,
         filingAutoGenerate, filingMockSubmit, filingPdfData
承認(4): approvalRequestCreate, approvalRequestApprove, approvalRequestReject, approvalRequestList
ユーザー(6): userInvite, userUpdateRole, userList, userSuspend, userUnsuspend, userDisableLogin
招待(1): invitationList
監査(1): auditLogList
ダッシュボード(2): dashboardStats, dashboardAnalytics
エクスポート(1): employeeExport
休業(3): leaveCreate, leaveList, leaveUpdate
免除(3): premiumExemptionCreate, premiumExemptionList, premiumExemptionUpdate
扶養(5): dependentCreate, dependentList, dependentGet, dependentUpdate, dependentDelete
徴収(3): collectionCreate, collectionList, collectionSummary
ポータル(2): portalOverview, portalPayslipGet
通知(3): notificationCreate, notificationList, notificationMarkRead
シミュレーション(1): premiumSimulate
バッチ(1): ageEventCheck
履歴(1): employeeHistoryList
サンプル(2): sampleTigersCreate, tigersRegister
シード(2): seedMasterData, seedGrades
```

### 既に実装済みで計画v1が見落としていた機能
- ダッシュボードの**タスク一覧**（今月のタスク4項目: 給与入力/保険料計算/承認処理/届出提出）
- ダッシュボードの**業務アラート**（届出期限超過/未徴収保険料/随時改定候補）
- ダッシュボードの**分析**（保険料推移・届出統計・前月比・来月予測）
- 従業員詳細の**入社オンボーディングステッパー**（employeeOnboard API）
- 従業員詳細の**退職パネル**（resignationDate + filingAutoGenerate連動）
- 従業員詳細の**異動パネル**（employeeTransfer API）
- `/onboard/:token` による**招待経由の入社フォーム**

### 構造的問題（v1と同様 + 補足）
1. **従業員詳細に業務が集中**: 入社ステッパー・退職パネル・異動パネル・休業・届出タブがすべてここ。業務の起点が「人を探す」に固定される
2. **月次業務の導線がない**: 給与→保険料→徴収→公開が独立画面。「今月の進捗」を横断的に見る場所がない
3. **手続き（案件）の追跡がない**: 入社ステッパーは結果を返すが、その後の承認・届出・e-Gov申請は別画面で個別管理。一連の手続きとして追跡できない
4. **既存操作と案件の同期がない**: employee-detailから退職処理しても、案件側に反映される仕組みがない（現在案件は存在しないが、導入後に必須）

---

## 2. 新しい画面構成

### 新サイドバー（8項目）
```
ホーム          → /home            今日やること・進行中案件・アラート
手続き          → /procedures      案件一覧（入社/退職/休業/月変/算定…）
定例業務        → /operations      月次・年次の定例業務（事業所×月単位）
                                   ※ 給与入力・保険料計算・徴収・明細公開はここ
従業員台帳      → /employees       従業員マスター＋手続き開始の入口
届出・帳票      → /filings         届出の横断一覧・PDF・模擬電子申請
集計・分析      → /analytics       確定済みデータの閲覧・推移・シミュレーション・予測
                                   ※ 操作画面ではなく、読み取り専用の分析ビュー
承認            → /approvals       承認待ち一覧（既存を維持）
設定            → /settings        会社・事業所・ユーザー管理
```

### 定例業務と集計・分析の役割分担

| | 定例業務（/operations） | 集計・分析（/analytics） |
|---|---|---|
| **目的** | 今月の作業を進める | 確定した結果を見る |
| **給与** | 入力・CSV取込・確定 | — |
| **保険料** | 計算実行・確定 | 月別推移・前月比 |
| **徴収** | 徴収データ生成・記録 | 徴収実績集計 |
| **明細** | 公開操作 | — |
| **算定** | 算定実行（年次業務） | — |
| **シミュレーション** | — | 保険料試算 |
| **予測** | — | 来月以降の予測 |

同じデータを参照するが、操作する画面（定例業務）と閲覧する画面（集計・分析）を分離する。

### トップバー
```
[会社ロゴ/名前]  [事業所切替: ▼ 本社]  [検索]  [通知🔔]  [ユーザーメニュー ▼]
```
- 事業所セレクターはグローバル。選択した事業所が全画面のデータ取得に反映
- admin: 「全事業所」選択可能
- operator: **担当事業所の横断表示**のみ可能（会社全体ではない）
  - UserDoc.officeIds に基づきフィルタ
  - 「全事業所」は表示しない。担当事業所が複数ある場合は「担当事業所すべて」

### ポータル
- サイドバーから分離。独自レイアウト（PortalLayoutComponent）
- ログイン後のロール判定:
  - employee ロールのみ → `/portal` へ直行
  - admin/operator → `/home` へ
- **退職後3か月間はポータル閲覧を維持**（カタログ準拠）
  - `resignationDate` から3か月以内: portalGuard はアクセスを許可
  - 3か月経過後: isLoginDisabled = true に自動移行（バッチまたは退職処理時にスケジュール）
  - 即時アカウント停止はしない

---

## 3. 案件（Procedure）データモデル

### Firestore パス
```
companies/{companyId}/procedures/{procedureId}
```

### ProcedureDoc（改訂版）

```typescript
interface ProcedureDoc {
  // 基本情報
  procedureType: ProcedureType;
  title: string;                    // 自動生成: "森下太郎 入社手続き"
  priority: 'high' | 'normal' | 'low';

  // ステータス — サーバーが実データから導出。クライアントは直接変更しない
  status: ProcedureStatus;
  statusReason: string;             // "承認待ち（田中が承認者）" など人間可読な理由

  // 対象（個人案件）
  employeeId: string | null;        // 入社前はnull
  employeeName: string;             // 非正規化（一覧表示用）。入社前は候補者名
  officeId: string;
  targetOfficeId: string | null;    // 異動先（transferの場合）

  // 対象（バッチ案件: 算定・賞与）
  scope: 'individual' | 'batch';
  batchMeta: {                      // scope === 'batch' の場合のみ
    targetYearMonth: string;        // "2026-07" (算定対象月)
    targetEmployeeIds: string[];    // 対象者リスト
    processedCount: number;         // 処理済み人数
    totalCount: number;             // 対象総数
  } | null;

  // 招待・入社前の紐付け
  invitationId: string | null;      // onboard/:token 経由の入社前
  onboardToken: string | null;

  // ステップ管理 — 依存関係グラフ
  steps: ProcedureStep[];
  // currentStepIndex は持たない。各ステップの状態と依存関係から「今できること」を導出

  // 期限
  deadline: Timestamp | null;
  effectiveDate: Timestamp | null;  // 資格取得日・喪失日など

  // 担当
  assignedTo: string;               // userId
  createdBy: string;

  // 関連ドキュメント参照（構造化）
  references: ProcedureReference[];

  // メモ
  notes: string;

  // 標準フィールド
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  deletedAt: Timestamp | null;
}

// --- 関連ドキュメント参照 ---
interface ProcedureReference {
  type: 'filing' | 'approval' | 'salary' | 'leave' | 'exemption' | 'employee' | 'grade' | 'collection';
  documentId: string;
  employeeId: string | null;        // バッチ案件で誰の分か特定
  documentSubtype: string | null;   // filingType, leaveType 等
  stepId: string;                   // どのステップが生成したか
  createdAt: Timestamp;
}

// --- ステップ ---
interface ProcedureStep {
  id: string;
  label: string;
  type: StepType;

  // 依存関係
  dependsOn: string[];              // 先行ステップのid。空配列 = 最初から着手可能
  isConditional: boolean;           // 条件付きステップ（条件不成立ならskip）
  condition: string | null;         // 条件の説明 "育児休業の場合のみ"

  // ステータス — サーバーが実データから導出
  status: StepStatus;
  statusDetail: string | null;      // "承認申請済み（承認者: 田中）" "差戻し: 書類不備"

  // 実データへの参照
  referenceType: string | null;     // 'filing' | 'approval' | 'employee' 等
  referenceId: string | null;       // 参照先ドキュメントID
  referenceStatus: string | null;   // 参照先の実際のステータス（filing.workflowStatus 等）

  // 操作
  actionLabel: string | null;       // "届出を作成" "承認申請を送る" — 今できる操作のラベル
  actionRoute: string | null;       // 操作先の画面パス

  // 完了情報
  completedAt: Timestamp | null;
  completedBy: string | null;
}

type StepStatus =
  | 'blocked'       // 先行ステップ未完了
  | 'available'     // 着手可能
  | 'in_progress'   // 作業中（関連ドキュメントが作成済みだが完了していない）
  | 'completed'     // 完了（関連ドキュメントが完了状態）
  | 'skipped'       // 条件不成立でスキップ
  | 'returned';     // 差戻し・返戻（要対応）

type ProcedureType =
  | 'acquisition'        // 入社（資格取得）
  | 'loss'               // 退職（資格喪失）
  | 'dependent_change'   // 扶養異動
  | 'maternity_leave'    // 産前産後休業
  | 'childcare_leave'    // 育児休業
  | 'monthly_change'     // 随時改定（月額変更）
  | 'annual_review'      // 算定基礎（バッチ）
  | 'bonus_payment'      // 賞与支払届（バッチ）
  | 'transfer'           // 異動
  | 'age_event';         // 年齢到達

type ProcedureStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'cancelled';
  // waiting_approval / waiting_submit は廃止
  // → status はステップ群の集約結果、statusReason に詳細を記述

type StepType =
  | 'data_entry'
  | 'document_create'
  | 'approval'
  | 'mock_filing'        // 模擬電子申請（"e-Gov申請" → カタログ準拠で「模擬」明記）
  | 'paper_submit'       // 紙提出記録
  | 'notification'
  | 'calculation'
  | 'account_control'    // アカウント制御（ポータル閲覧期間設定含む）
  | 'confirmation';
```

### ステータス導出ルール（最重要）

**案件のstatusとステップのstatusは、`procedureRefresh` APIがサーバー側で計算する。**
クライアントが直接変更するのはメモ・担当・優先度のみ。

```
procedureRefresh(procedureId) の処理:
  1. 案件の全referenceを取得
  2. 各ステップについて:
     - referenceId があれば、参照先ドキュメントの最新状態を読む
     - 参照先のステータスに基づきステップのstatusを判定:
       approval.status === 'approved' → step.status = 'completed'
       approval.status === 'rejected' → step.status = 'returned'
       approval.status === 'pending'  → step.status = 'in_progress'
       filing.workflowStatus === 'rejected' → step.status = 'returned'
     - referenceId がなく、依存ステップが全てcompleted → 'available'
     - referenceId がなく、依存ステップに未完了あり → 'blocked'
     - isConditional && 条件不成立 → 'skipped'
  3. 案件のstatusを集約:
     - 全ステップが completed/skipped → 'completed'
     - いずれかが returned → statusReason に差戻し理由
     - それ以外 → 'in_progress', statusReason に最も進んだステップの情報
  4. statusReason を人間可読な形で生成
  5. procedureドキュメントを更新（version++）
```

**refreshのトリガー**:
- 関連ドキュメントの状態変更時（承認/却下/差戻し/届出ステータス変更）
  → 各service内で `procedureRefresh` を呼ぶ
- 案件詳細画面を開いた時（procedureGet内で自動refresh）
- 手動リフレッシュボタン

### ステップテンプレート（案件タイプ別 — 依存関係付き）

#### 入社（acquisition）
```
A. 従業員情報登録    dependsOn: []           → employeeCreate / employeeOnboard
B. 届出データ作成    dependsOn: [A]          → filingAutoGenerate(acquisitionNotification)
C. 社内承認         dependsOn: [B]           → approvalRequestCreate
D. 模擬電子申請     dependsOn: [C]           → filingMockSubmit
E. 紙提出記録       dependsOn: [C]           → filingRecordResult (紙の場合)
F. 完了確認         dependsOn: [D] or [E]    → 手動
```
- D/Eは並行可能（電子と紙のどちらかでよい）
- 入社前（invitationId あり）: ステップAは onboard フォーム送信で完了

#### 退職（loss）
```
A. 退職情報入力      dependsOn: []           → employeeResign
B. 最終給与精算      dependsOn: []           → 定例業務の給与確定を待つ（並行可能）
C. 届出データ作成    dependsOn: [A]          → filingAutoGenerate(lossNotification)
D. 社内承認         dependsOn: [C]           → approvalRequestCreate
E. 模擬電子申請     dependsOn: [D]           → filingMockSubmit
F. 紙提出記録       dependsOn: [D]           → filingRecordResult
G. ポータル期間設定  dependsOn: [A]          → 退職日+3か月の閲覧期限を設定
H. 完了確認         dependsOn: [D or E or F], [G]
```
- Bは他のステップをブロックしない（精算待ちで届出まで止まらない）
- Gは退職情報入力後すぐ設定可能（届出とは独立）

#### 算定基礎（annual_review — バッチ案件）
```
scope: 'batch'
batchMeta: { targetYearMonth: '2026-07', targetEmployeeIds: [...], ... }

A. 対象者確認        dependsOn: []           → 事業所の4-6月給与データ確認
B. 算定基礎計算      dependsOn: [A]          → 既存santei機能
C. 社内承認          dependsOn: [B]          → approvalRequestCreate
D. 届出データ一括作成 dependsOn: [C]          → filingAutoGenerate × 対象者数
E. 模擬電子申請      dependsOn: [D]          → filingMockSubmit（一括）
F. 完了確認          dependsOn: [E]
```
- 手続き画面と定例業務画面の両方からアクセス可能
- 入口は二つ、管理する案件は一つ

#### 異動（transfer）
```
officeId: 異動元, targetOfficeId: 異動先

A. 異動情報入力      dependsOn: []           → employeeTransfer
B. 届出データ作成    dependsOn: [A]          → 必要に応じて届出生成
C. 社内承認         dependsOn: [B]           → approvalRequestCreate
D. 完了確認         dependsOn: [C]
```
- 異動元・異動先の両方の事業所権限を持つユーザーが操作可能
- operatorの場合: 両方の事業所がofficeIdsに含まれている必要あり

---

## 4. 各画面の設計

### 4-1. ホーム（/home）
既存ダッシュボードのアラート・統計・分析は維持しつつ、案件タスクを最上部に追加。

```
┌─────────────────────────────────────────────────┐
│ おはようございます、前田さん                        │
│                                                   │
│ ■ 進行中の手続き                        [すべて→] │
│ ┌───────────────────────────────────────────────┐ │
│ │ 🔴 森下太郎 入社手続き                          │ │
│ │    模擬電子申請が可能です  期限: 11/5            │ │
│ │ 🟡 山田花子 退職手続き                          │ │
│ │    社内承認待ち（田中が承認者）  期限: 11/15     │ │
│ │ 🔵 10月 算定基礎届                              │ │
│ │    対象45名中 38名完了  [詳細→]                  │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ ■ 業務アラート（既存のalerts-sectionを移植）        │
│ ■ 統計サマリー（既存のstats-rowを移植）             │
│ ■ 今月のタスク + クイック操作（既存を維持）          │
│ ■ 分析（既存のanalytics-sectionを移植）            │
└─────────────────────────────────────────────────┘
```

**実装方針**: 既存DashboardComponentを拡張。新規APIは不要（procedureList を追加呼び出しするだけ）。

### 4-2. 手続き（/procedures）

#### 手続き一覧
フィルター: ステータス、種別、担当者、事業所、対象者名検索

#### 手続き詳細（/procedures/:id）
```
┌─────────────────────────────────────────────────┐
│ ← 手続き / 森下太郎 入社手続き                     │
│ ステータス: 進行中  担当: 前田  期限: 2026-11-05   │
│                                                   │
│ ■ 作業状況                                        │
│ ┌───────────────────────────────────────────────┐ │
│ │ ✅ 従業員情報登録        完了 10/28 (前田)      │ │
│ │ ✅ 届出データ作成        完了 10/28 自動生成     │ │
│ │ ✅ 社内承認              承認済み 10/29 (田中)   │ │
│ │                                                 │ │
│ │ 🟢 今できること:                                 │ │
│ │ ┌─────────────────────────────────────────────┐ │ │
│ │ │ 模擬電子申請  [申請画面を開く]                │ │ │
│ │ │ 紙提出記録    [提出結果を記録]                │ │ │
│ │ └─────────────────────────────────────────────┘ │ │
│ │                                                 │ │
│ │ ⏳ 待機中:                                       │ │
│ │    完了確認 — 模擬電子申請 または 紙提出を待機中  │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ ■ 関連ドキュメント                                │
│ - 従業員: 森下太郎 (emp_xxx)                      │
│ - 届出: 資格取得届 (fil_xxx) — 承認済み           │
│ - 承認: 承認済み (田中, 10/29) (apr_xxx)          │
│                                                   │
│ ■ メモ                                            │
└─────────────────────────────────────────────────┘
```

**ポイント**: 「現在のステップ」ではなく「今できること」「待っている理由」「次の担当者」を表示。

### 4-3. 定例業務（/operations）
**操作画面。保険料計算・徴収はここに置く。**

```
┌─────────────────────────────────────────────────┐
│ 定例業務                                          │
│ 事業所: [本社 ▼]  年月: [◀ 2026年10月 ▶]        │
│                                                   │
│ ■ 月次業務                                        │
│ ✅ 給与データ入力     45/45名 完了  [給与一覧→]    │
│ ✅ 給与確定           45/45名 確定  [一括確定→]    │
│ 🔵 保険料計算         実行可能      [計算実行→]    │
│ ⬜ 社内承認           ← 保険料計算の完了待ち       │
│ ⬜ 徴収データ生成     ← 承認待ち    [徴収画面→]    │
│ ⬜ 明細公開           ← 徴収完了待ち               │
│                                                   │
│ ■ 年次業務                                        │
│ 🔵 算定基礎届（7月届出 / 4-6月実績）[案件を開く→] │
│                                                   │
│ ■ 今月の検知事項                                  │
│ - 随時改定候補: 鈴木次郎                           │
│ - 年齢到達: 佐藤一郎 40歳                          │
└─────────────────────────────────────────────────┘
```

各ステップのリンクは既存画面へ遷移。定例業務画面自体は進捗の集約表示。

### 4-4. 従業員台帳（/employees）
既存の従業員一覧・詳細を維持。

**従業員詳細の変更**:
- 退職パネル・異動パネルのボタンは**削除しない**
- ボタンクリック → **対象者を選択済みの状態で手続き作成画面に遷移**
  - 「退職」ボタン → `/procedures/new?type=loss&employeeId=xxx`
  - 「異動」ボタン → `/procedures/new?type=transfer&employeeId=xxx`
- 既存のオンボーディングステッパー → 入社案件の「従業員情報登録」ステップとして統合
- 進行中の手続きがあれば、詳細画面にバナー表示

### 4-5. 届出・帳票（/filings）
既存を維持。変更点:
- フィルターに「案件」を追加
- 「模擬電子申請」と「紙提出記録」を明確に区別（カタログ準拠）
- 届出詳細に「この届出を含む手続き」へのリンク

### 4-6. 集計・分析（/analytics）— 読み取り専用
```
[保険料推移] [届出統計] [シミュレーション] [予測]
```
- 保険料推移: 既存のanalytics-section（月別テーブル、前月比）を移植
- 届出統計: 既存のfiling-stats を移植
- シミュレーション: 既存 `/simulation` を移植
- 予測: 既存のforecast-cardを移植
- **操作機能（計算実行・徴収生成等）はここに置かない**

---

## 5. 新規API設計

### 5-1. Procedure API
```
procedureCreate(companyId, procedureType, employeeId?, officeId, ...)
  → テンプレートからステップを生成、案件ドキュメントを作成

procedureGet(companyId, procedureId)
  → 内部で procedureRefresh を実行してから返却
  → 常に最新の実データ状態を反映

procedureList(companyId, filters: { status?, type?, assignedTo?, employeeId?, officeId? })
  → カーソルベースページネーション

procedureUpdate(companyId, procedureId, { notes?, assignedTo?, priority?, expectedVersion })
  → メモ・担当・優先度のみ。ステータスは変更不可

procedureCancel(companyId, procedureId, { reason, expectedVersion })
  → ステータスをcancelledに。関連ドキュメントは変更しない

procedureRefresh(companyId, procedureId)
  → 内部関数。関連ドキュメントの実状態からステップ・案件ステータスを再計算
  → procedureGet / 関連ドキュメント変更時 / 手動リフレッシュから呼ばれる
```

**procedureAdvance は作らない。** ステップの進行は、関連ドキュメントの操作（届出作成、承認、etc）によって間接的に起こり、procedureRefresh が検知する。

### 5-2. Operations API
```
operationsMonthlyStatus(companyId, officeId, yearMonth)
  → 給与入力状況、確定状況、保険料計算状況、承認状況、徴収状況、公開状況
  → 既存APIの結果を集約（新規コレクション不要）
```

### 5-3. 既存API変更（案件連動）
以下のAPIに `procedureId?: string` オプションを追加:
- `filingAutoGenerate` → 成功時に案件のreferencesに追加 + procedureRefresh
- `approvalRequestCreate` → 同上
- `approvalRequestApprove` / `approvalRequestReject` → procedureRefresh
- `filingMockSubmit` → procedureRefresh
- `filingRecordResult` → procedureRefresh

以下のAPIに案件自動作成を追加:
- `employeeCreate` / `employeeOnboard` → acquisition Procedure 自動作成
- `employeeResign` → loss Procedure 自動作成（退職日+3か月のポータル閲覧期限を設定）
- `employeeTransfer` → transfer Procedure 自動作成
- `leaveCreate` → maternity_leave / childcare_leave Procedure 自動作成

---

## 6. 実装順序（縦割り: 入社を一本通す）

### Step 1. ProcedureDoc + CRUD API + テンプレートエンジン
- `functions/src/procedures/` 配下に: schema, service, functions
- procedureCreate, procedureGet, procedureList, procedureUpdate, procedureCancel
- procedureRefresh（内部関数）
- 入社テンプレートのステップ定義
- **検証**: API単体テスト、procedureRefresh のロジックテスト

### Step 2. 入社フロー一本通し
- `employeeCreate` / `employeeOnboard` に案件自動作成フックを追加
- `filingAutoGenerate` に procedureId 対応を追加
- `approvalRequestCreate` / `approve` / `reject` に procedureRefresh を追加
- `filingMockSubmit` / `filingRecordResult` に procedureRefresh を追加
- 手続き詳細画面（/procedures/:id）を作成 — ステップ表示、関連ドキュメントリンク、アクションボタン
- 手続き一覧画面（/procedures）を作成
- **検証**: 従業員登録→届出自動生成→承認→模擬申請→完了 を一連で通す。途中で承認却下→差戻し表示も確認

### Step 3. 既存画面からの操作も同じ案件へ反映
- employee-detailの退職ボタン → 手続き作成画面へ遷移（対象者プリセット）
- employee-detailの異動ボタン → 同上
- 既存画面から操作しても案件が更新されることを検証
  - 例: filings画面から直接承認しても、案件のステップが更新される
- 案件がない状態での既存操作は従来通り動作（後方互換）

### Step 4. ホーム + 事業所セレクター + 新サイドバー
- ホーム画面: 既存ダッシュボードを拡張（進行中案件一覧を追加）
- グローバル事業所セレクター（SelectedOfficeService）をトップバーに追加
- 新サイドバー8項目に切り替え
- ルーティング再構成（app.routes.ts）
- ポータル分離（PortalLayoutComponent）
- **検証**: 新サイドバーで全画面アクセス可能、事業所切替で表示データが変わる

### Step 5. 退職・月次・休業・算定・賞与への展開
- 退職テンプレート（ポータル閲覧期限設定ステップ含む）
- 休業テンプレート（産前産後・育児、条件付きステップ）
- 月次定例業務画面（/operations）+ operationsMonthlyStatus API
- 算定・賞与のバッチ案件テンプレート
- 異動テンプレート（異動元・異動先officeId）
- `employeeResign`, `leaveCreate`, `employeeTransfer` に案件自動作成フック

### Step 6. 従業員詳細整理 + 集計画面
- 従業員詳細のアクションボタン → 手続き画面へ遷移に変更
- 従業員詳細に「進行中の手続き」バナー追加
- 集計・分析画面（/analytics）— 既存の分析コンポーネントをタブ統合
- シミュレーション画面の移設

---

## 7. 注意事項と設計判断

### 二重案件の防止
- procedureCreate 時に、同一 employeeId + procedureType + status !== 'completed'/'cancelled' の案件がないかチェック
- バッチ案件は officeId + yearMonth + procedureType でチェック

### 既存操作との互換
- 案件なしでの既存操作は引き続き可能（procedureId はオプション）
- 案件ありの場合のみ、操作結果が案件に反映される
- 段階的に「案件経由の操作」を推奨していく

### 権限
- 案件の閲覧・操作は、対象者のofficeIdに基づく
- 異動案件: officeId（異動元）とtargetOfficeId（異動先）の両方の権限が必要
- バッチ案件: 事業所の権限

### 模擬電子申請の表記（カタログ準拠）
- UIでは「模擬電子申請」と表示（「e-Gov申請」ではない）
- 紙提出記録と分離して管理
- filingMockSubmit → 模擬電子申請、filingRecordResult → 紙提出記録

### 退職後のポータル閲覧（カタログ準拠）
- 退職処理時に `portalAccessUntil: resignationDate + 3か月` を設定
- portalGuard: `isLoginDisabled === false && (isActive || portalAccessUntil > now)`
- 3か月経過後の自動無効化: ageEventCheck バッチに追加 or 退職処理時にスケジュール

---

## 8. この計画で確定していないこと

以下は実装しながら詳細を決める:

1. **procedureRefresh の性能**: 全参照先を読む処理のコスト。案件一覧では最新refreshせず、キャッシュされた状態を返す可能性
2. **バッチ案件の粒度**: 算定45名を1案件で管理するか、事業所単位で分割するか
3. **通知との統合**: 案件のステップ変化時に自動通知を出すか、既存のnotify関数をどう接続するか
4. **既存オンボーディングステッパーの扱い**: 案件のステップAとして統合するか、独立して残すか
5. **工数**: Step 1-2 で案件の核心部分の複雑さが判明してから、後続ステップの見積もりを出す
