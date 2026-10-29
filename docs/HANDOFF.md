# 引継ぎ（最新）

更新：2026-10-29（段階6 退職・扶養のウィザードを作成し完了まで画面で確認。次は産休・育休）。新しいセッションは最初にこのファイルを読む。応答は日本語で行う。

## 1. 目的と前提

- 目標：`C:\Users\pluser1\Desktop\社会保険管理システム 機能カタログ ちょーろんぐばーじょん.txt`（機能カタログ第2版）どおりに作り、労務担当の初心者でも迷わず使え、大人数の企業にも対応する。迷ったらカタログを正とする（ユーザー手元の設計書 `Downloads/screen-flow.md` 等はカタログと差がある）。
- 構成：Angular（`src/`）＋ Cloud Functions 2nd Gen（`functions/`、Callable・Zod）＋ Firestore。Firebase プロジェクト `kensyu10171`（本番だがデータはテスト用のみ）。Firestore は **asia-northeast1**、関数は原則 us-central1。
- GitHub：`shota-maeda-pathos/shaho-app-10171-`（公開）。最新コミットは `git log` で確認する。push はユーザーがアプリ外の PowerShell で行う。

## 2. 経緯（要約）

1. 以前は機能を横に広げて作ったが、どの業務も最後まで通らず計算誤りも多かった。2026-10-29 にカタログとの乖離を洗い出し、`docs/roadmap.md`（段階0〜10）に一本化した。
2. 段階0：独立リポジトリ化、チェックリスト `docs/catalog-checklist.md` 作成。
3. 段階1：法令計算をサーバーの純粋関数 `functions/src/insurance/calculator/` に集約（端数処理・等級表・支払基礎日数・随時改定・免除・得喪・適用判定）。
4. 段階2：共通UI部品 `src/src/app/shared/ui/`（ウィザード・対象者一覧・状態色・用語集・デザイントークン）。
5. 段階3：入社（個人型の見本）`/onboarding`。招待→本人入力→台帳→雇用条件→資格取得届・承認→提出→完了を画面で確認。
6. 段階4：毎月の処理（一括型の見本）`/monthly`。300名・2か月分で最後まで通した（下記）。途中で本番の料率マスタの単位誤りを発見・修正した。
7. 段階5：ホームとナビ。やることリスト・ライフイベントのカード・サイドバー5項目（下記）。
8. 段階6（途中）：退職のウィザード `/resignation/:id`、扶養のウィザード `/dependents/:id`（下記）。どちらも承認・模擬電子申請・完了まで画面で確認した。

## 3. 決定事項（ユーザー承認済み）

- **縦に1本ずつ仕上げる**（データ→計算→画面→一括操作→実ブラウザー確認）。**完了は実ブラウザーで確認できた項目だけ ✅**。ビルドやテストの成功だけでは完了にしない。
- **法令計算はサーバーのみ**（`calculator/`）。画面から送られた値は信用せず、サーバーで再計算して承認申請する。
- **手続きは2つの型**：個人型（`app-wizard`）と一括型（`app-target-list`：要対応だけ表示・全員に一括操作・保留・失敗した人だけ再実行）。
- **料率は ‰（1000分の1）で登録する**（例：健保 98.5、本人 49.25）。1未満の料率では計算を止める安全策あり。
- 届出の状態は内部3軸（社内承認・模擬申請・紙提出）、画面はカタログの状態名で表示。
- サイドバーは5項目（ホーム／手続きを始める／毎月の処理／従業員／承認）＋開閉式の「その他」（進行中の手続き・届出・集計・用語集・設定）。

## 4. 重要な仕様（段階4 毎月の処理）

- 単位は **事業所×給与の支給月**。控除する保険料の月は事業所の `deductionMethod`（`previous`＝翌月控除なら前月分、`current`＝当月分）で決まる（`monthly/rules.ts` の `premiumMonthFor`）。
- 6ステップ：給与を取り込む → 給与の確認 → 保険料を計算 → 結果の確認 → 明細を公開 → 徴収を記録。各ステップの対象者一覧は要対応を先に出し、承認者には承認待ちのステップを先に開く。
- サーバー `functions/src/monthly/`：
  - `monthlyRunOverview`：全員分の状況（上限3000名）。前月差額と理由、給与と等級の開き（25%以上）、徴収方法（給与控除／別途入金）、料率の変化（`rateFingerprint`）、差し戻し理由（`lastRejection`）、給与項目マスタを返す。
  - `monthlySalaryImport`：CSVの確認（dryRun）と取込。誤りの行は行番号つきで返し取り込まない。手当の列は給与項目マスタ（`settings/salaryItems`、`monthlySalaryItemsUpdate`）の名前、または「固定:〇〇」「非固定:〇〇」。
  - `monthlyJobStart`/`monthlyJobGet`/`monthlyJobChunk`：一括処理。`monthlyJobs/{id}/chunks`（25名ずつ）を Firestore トリガー（asia-northeast1）が並行処理。失敗は `failures/`。10分超は停止扱い。画面を開き直しても直前の失敗を読み込み直して再実行できる。
  - そのほか：`monthlyRunHold`（保留。月ごと）、`monthlySalaryNoPay`（無給）、`monthlyCollectionEntry`（給与控除・別途入金・返金。`collectionReceipts/{保険料の月}`）。
- 月次計算は給与の承認を求めない（無給の休職者も計算する）。明細の公開時に給与へ `deductedPremiumMonth` を記録し、ポータルはその月の保険料を表示する。
- 承認：既存の承認申請（決まったID `salary-{月}-v{版}` など）を使う。まとめて承認するときは通知1件（`{ notify: false }`）。依頼した本人は承認できない。承認一覧 `approvalRequestList` は承認待ちを件数で切らずに返す。
- 給与の1人分の入力 `/salary/:id`：手当・支払基礎日数・現物給与・遡及差額を読み込み・保存。毎月の処理から開くと保存後に戻る。

## 4-2. 重要な仕様（段階5 ホームとナビ）

- ホーム `/home` はやることリスト（期限の近い順、「続きから」／待ちは「状況を見る」）と「新しく始める」のカード。統計の表は外した（集計は段階9）。
- サーバー `functions/src/home/`：`homeTodos`（us-central1）。
  - 入社：ウィザードの今のステップから次にやることを出す。期限は資格取得届の期限。本人の入力待ち・承認待ち（自分が依頼したものは待ち）・差し戻しの理由を出す。
  - 退職・扶養：`wizardTodo`（ウィザードの今のステップ・承認待ち・差し戻し・返戻と届出の期限）。それ以外の手続き：返戻→進行中→着手可能の順で最初のステップ（ウィザード化するまでの仮。`procedureTodo`）。
  - 毎月の処理：事業所ごとに当月分と、前後の月で始めて終わっていないもの。`monthlyOverview` を呼び、**画面と同じ判定**（`home/monthly-progress.ts` の `stepTone`、画面の `monthly.types.ts` の `stepState` と対応。判定を変えるときは両方を直す）で次のステップと残り人数を出す。期限は給与の支給日（`paymentDay`）。最初は最後の一括処理から推測したが、承認一覧で承認した場合などに誤ったため改めた。
  - 承認者だけの人には「あなたの番」だけを返す。読み込みは約5秒（事業所×月ごとに全員分を読むため）。
- ライフイベントのカード `features/procedures/life-events.ts`（9種）をホームと `/procedures/new` で共通に使う。従業員を選ぶ業務はカードの下で従業員を選ぶ。退職・扶養はウィザードへ、休業・異動はまだ従業員詳細へ進む。
- サイドバーの選択表示は URL から1つだけ決める（`layout.ts` の `activeRoute`）。旧 `/operations` は `/procedures/new` へ転送し、画面のファイルは削除した。

## 4-3. 重要な仕様（段階6 退職）

- 入口：「人が退職する」のカード（`procedure-start.ts` で従業員を選ぶ）と、従業員詳細の「退職」ボタン（`?action=loss` も同じ）。どちらも `resignationStart` で手続きを作ってウィザードを開く。同じ人の進行中の退職手続きがあればそれを開く。従業員詳細の旧い退職パネル（`employeeResign` を直接呼ぶ）は削除した。`employeeResign` 関数自体は残っている。
- サーバー `functions/src/resignation/`（us-central1）：`resignationStart`・`resignationGet`・`resignationPreview`（kind: entry／settlement）・`resignationUpdate`（step: entry／settlement／account／filing／complete）。手続きは `procedureType: 'loss'` に `resignation` の状態を持つ（旧方式の退職手続きにはない）。ステップは `templates.ts` の `RESIGNATION_STEPS`。
- 法令の判定は `resignation/rules.ts`（純粋関数・テストあり）：喪失日＝翌日、保険料は喪失月の前月分まで（月末退職は退職月も、同月得喪は1か月分）、喪失届の期限＝喪失日＋5日、閲覧期間＝喪失日から3か月の応当日の前日まで、70歳以上被用者不該当、外国人の脱退一時金の案内。
- 最後の保険料：最後の月とその前2か月について、`monthlyInsurance`（承認済み・計算済み）と `collectionReceipts` を読み、未計算の月は最新の等級から見込みを出す。等級がない月は「計算できません」で決められない。集め方は「いつもの控除月の給与」→「最後の給与からまとめて（前月分と当月分）」→「別途入金」。「退職後に支給する給与はない」を選ぶと、まとめての控除はできない。別途入金・返金があれば通知する。実際の徴収の記録は毎月の処理の「徴収を記録」で行い、ウィザードは開くたびに最新の残りを出す。
- 退職日を登録すると、台帳の `isActive=false`・`resignationDate`・`qualificationLostDate`・`portalAccessUntil` を書く（未来の退職日でもすぐ退職済みになるのは旧方式と同じ）。利用者には `suspendFrom`（喪失日）・`loginDisabledFrom`（閲覧期間の翌日）を書き、`middleware/auth.ts` と画面の `auth.service.ts` が東京の今日と比べて閲覧専用・ログイン停止にする。権限（roles）は消さない。喪失日を過ぎていれば `isSuspended=true` も書く（日付を見ない旧い関数のため）。
- 資格喪失届：喪失原因（退職等／死亡）・喪失する保険・70歳以上被用者不該当・最終の標準報酬月額・保険証の回収枚数。承認申請は入社と同じ仕組み（`linkApprovalToProcedure`）。社会保険に加入していない人は届出・承認・提出が「不要」になり、完了は手続き側で閉じる。
- ホーム：`home/service.ts` の `resignationTodo`。期限は喪失届の期限（提出後は出さない）、別途回収の額を補足に出す。

## 4-4. 重要な仕様（段階6 扶養）

- 入口：「家族が増えた・減った」のカード（`procedure-start.ts` の `start()` でウィザードの業務をまとめて扱う）と、入社のウィザードの完了画面の「扶養の手続きを始める」（本人が申し出た家族を「扶養に入れる」として引き継ぐ）。同じ人の進行中の扶養の手続きがあればそれを開く。健康保険に加入していない人は始められない。
- サーバー `functions/src/dependent-change/`：`dependentChangeStart`・`dependentChangeGet`・`dependentChangePreview`（入れかけの内容でも判定できる）・`dependentChangeUpdate`（step: change／filing／complete）。手続きは `procedureType: 'dependent_change'` に `dependentChange` の状態を持つ。ステップは `DEPENDENT_WIZARD_STEPS`。
- 判定は `dependent-change/rules.ts`（純粋関数・テストあり）：収入要件（原則130万円未満、19〜22歳（配偶者を除く）150万円未満、60歳以上・障害者180万円未満。年齢は認定日の年の12月31日時点）、75歳以上は不可、同居が要件の続柄（その他の親族）、別居の仕送り、第3号被保険者（20〜59歳の配偶者）、期限（いちばん早い異動日＋5日）、添付書類の目安。基準以上でも理由を入れれば届け出られる。
- 1つの手続きで、扶養に入れる・外す・変わった人を複数まとめて届け出る（届出は1件、`被扶養者一覧` に人ごとの行）。**台帳（`dependents`）への反映は完了時**（提出前に台帳を変えて届出と食い違うのを防ぐ）。追加は `certification: 'certified'`、外す人は `disqualificationDate`・`disqualificationReason`・`certification: 'removed'`。続柄は英字の値（spouse など）で持ち、旧データの日本語は `toRelationship` で寄せる。
- 退職・扶養で共通の小さな処理は `procedures/wizard.ts`、ホームの出し方は `home/service.ts` の `wizardTodo`。
- `dependentList` が本番にない複合索引を要していて、従業員詳細の扶養家族タブが読めなかった（以前から）。索引に頼らない形に直した。

## 5. 現在の状態（本番）

- 段階4の関数と `homeTodos` はデプロイ済み。段階6の `resignationStart`・`resignationGet`・`resignationPreview`・`resignationUpdate`・`userUnsuspend`（今回が初公開）、扶養の `dependentChangeStart`・`dependentChangeGet`・`dependentChangePreview`・`dependentChangeUpdate`、直した `dependentList` もデプロイ済み。認証（`middleware/auth.ts`）の変更は、これらの関数にだけ反映されている。**Hosting（画面）は未公開**（ローカルの開発サーバーで確認している）。
- 料率マスタ：2026-10-29 に修正済み（単位を ‰ に、協会けんぽ令和7・8年度の東京・大阪・兵庫の健保と介護を追加。修正関数 `migrateInsuranceRates`）。全国一律の厚年・拠出金は、甲子園のサンプル用の料率（2026-04〜）で決まっている（値は正しい）。
- テストデータ：
  - 本社・2026年11月支給の3名（テスト 入社太郎・岩貞 祐太・前田 翔太）は6ステップ完了。本社に別途追加された「高橋 三郎（T-11111）」は等級なしで「計算できません」。
  - 「サンプル負荷テスト事業所」（`sample-load-office`、翌月控除、300名、`sampleLoadCreate` で作成）：2026年10月・11月支給は完了。12月支給には LOAD-0001 の未承認の給与が1件だけある。給与項目マスタに「住宅手当」を追加済み。
  - 本番にユーザーが作った入社手続き「前田 翔太」（9月1日入社）が2件ある。旧方式の退職手続き「前田 翔太 退職手続き」も進行中で残っている。
  - 扶養のテスト（2026-10-29）：LOAD-0298 林 修に配偶者 林 花子（年収100万円）と子 林 太郎（2006年生まれ・年収140万円）を 2026-11-01 付けで追加し、完了まで通した（台帳に2人いる）。
  - 退職のテスト（2026-10-29、いずれも退職日 2026-11-30）：LOAD-0299 斎藤 修は完了（模擬電子申請済み。別途入金 45,000円は未記録のまま）。LOAD-0300 清水 修は等級なしのため「最後の保険料の集め方」で止まっている（等級なしの表示の確認用）。どちらも台帳は退職済み。
- 端数処理の移行（`migrateOfficeRoundingRule`）は未実行。会社設定の「特定適用事業所」は未登録（3/4未満の人の加入判定が「担当者の判断が必要」になる）。
- テスト：521件中512件成功。失敗9件は改修前から（各テスト独自のモックが手続き機能に追随していない。段階10で対応）。

## 6. 次にやるべきタスク

1. **段階6 退職の任意の確認**：紙の提出・差し戻しの表示、アカウントのある人での閲覧専用・ログイン停止、70歳・75歳・外国人の人（いずれも該当するテストデータがない）。
2. **段階6：残りの業務を型に当てはめる**（産休・育休から。下の「産休・育休の着手メモ」を先に読む）。扶養の任意の確認：非該当・変更・紙の提出、入社から引き継ぐ流れ。
3. **速さの判断（ユーザーに確認）**：ホーム約5秒、毎月の処理の状況5〜6.5秒、承認一覧約8秒（関数が us-central1・Firestore が東京のため）。読み込みの多い関数を asia-northeast1 に移す案（画面の呼び出し先の変更も必要）。
4. 任意の確認：承認者だけのアカウントでのホーム表示（段階5）。料率が変わったときの「計算し直しが必要」、差し戻しの表示、ポータルの明細（段階4）。いずれも別アカウントが要る。
5. 以前からの残り：認証の変更を全関数に反映する再デプロイ（承認要）、端数処理の移行の実行（承認要）、入社の差し戻し・返戻の画面確認、特定適用事業所の登録（ユーザーに確認）、Hosting の公開（承認要）、サンプルデータの等級の修正。
6. 以降は `docs/roadmap.md` の段階7〜10。後続課題は `docs/catalog-checklist.md` の末尾。

### 段階6の着手メモ

- **順番**（ロードマップ）：退職（済み）→ 扶養（済み） → 産休・育休 → 算定基礎届 → 賞与 → 随時改定・終了時改定 → 年齢到達。業務ごとに「データ→計算→画面→一括操作→実ブラウザー確認」を終え、チェックリストを埋めてから次へ進む。
- **型**：退職・扶養・産休育休・随時改定・年齢到達は個人型（入社のウィザード `features/onboarding/onboarding-wizard.ts` ＋ `functions/src/onboarding/` が見本）。算定基礎届・賞与は一括型（毎月の処理 `features/monthly/` ＋ `functions/src/monthly/` が見本）。
- **入口**：ライフイベントのカード `features/procedures/life-events.ts`。休業・異動は今 `procedure-start.ts` で従業員を選び、従業員詳細 `/employees/:id?action=<種類>` へ移る。退職・扶養は `start()` の `wizard` の表でウィザードへ移る（見本にする）。随時改定は `/employees/:id/revision`。ウィザードができたら、`procedure-start.ts` の `start()` で行き先を変える。
- **退職の作り（見本）**：上の「4-3」を参照。画面は `features/resignation/`（入社のウィザードのスタイルを共用）。旧方式の `employeeResign`／`createLossProcedure`／`LOSS_STEPS` は画面から使っていない。
- **ホーム**：ウィザードを作った業務は `home/service.ts` の `wizardTodo` を使い、`procedureTodos` の振り分けに1行足す（退職・扶養と同じ）。`home/rules.ts` と画面の `dashboard.ts` の `kind` にも種類を足す。
- **既知の不具合**：休業の届出が承認されても免除が有効にならない（`approvedAt` を手入力。チェックリスト末尾）。産休・育休で直す。

### 産休・育休の着手メモ（次のセッションはここから）

- **現状**：`functions/src/leaves/leave-create/service.ts`（`leaveCreate`）が、休業（`leaves`）と免除（`premiumExemptions`、`status: 'pending'`・`approvedAt: null`）と申出書の下書き（`maternityLeaveStart`／`childcareLeaveStart`）を一度に作る。画面は従業員詳細の「休業」タブ（`?action=leave` で開く）。手続きは作らない（`MATERNITY_LEAVE_STEPS`／`CHILDCARE_LEAVE_STEPS` は旧方式のテンプレートのみ）。
- **免除の判定**：`utils/exemption-period.ts` の `decideExemption` が、`status: 'active'` かつ `approvedAt` がある免除だけを使う（月末・14日・賞与の1か月超は `insurance/calculator/exemption.ts` で休業期間から判定）。今は承認しても `pending` のままなので、免除が効かない。**申出書の承認を確認したら、免除を `active`・`approvedAt` にする**処理をウィザード側に入れる（承認の共通処理には手を入れない方が安全）。
- **期間の計算**：`calculator/exemption.ts` の `maternityLeavePeriod`（産前42日・多胎98日・産後56日、実出産日での変更）と `exemptMonths`。テストあり。
- **カタログの要件**（届出⑧⑨⑪⑫と免除の章）：出産予定日・実出産日から期間を自動計算、出産日が予定と違えば変更届、予定より早い終了は終了届、育休の延長・終了届、免除は届出承認で反映、終了時改定（段階1で判定と承認申請は実装済み、休業終了からの導線がない）。
- **作り方の案**：退職・扶養と同じ個人型。`functions/src/leave-change/`（仮）に rules.ts・service.ts、画面は `features/leave/`、入口は `procedure-start.ts` の `wizard` の表に `leave` を足す。産休と育休は1つのウィザードで種類を選ぶか、続けて行えるようにする（産休の終了後に育休が始まることが多い）。休業中・復帰後の「変更届・終了届・終了時改定」は、同じ手続きの後半か別の手続きかを最初に決める。
- **確認用データ**：サンプル負荷テスト事業所の女性はいない（`sampleLoadCreate` は全員男性）。産休の確認には本社などの女性従業員を使うか、テスト用に作る（本番への書き込みはユーザーに確認）。

## 7. 作業上の注意

- **本番への書き込み・デプロイ・Hosting の公開は事前にユーザーに確認する。** 本番の認証にパスワードを入力しない。承認の確認には別アカウントが要る（ユーザーが操作）。
- **デプロイ**は PowerShell から関数名を明示して行う（Bash からは firebase CLI が動かない）：
  `firebase deploy --only functions:default:<名前>,functions:default:<名前> --project kensyu10171 --non-interactive`
  全体デプロイはしない（未公開の関数が13個あり、個人番号が平文のものを含む）。別 codebase `socialinsurance` に触れない。
- **Firestore の索引**：`firestore.indexes.json` は本番より古い。索引のデプロイは本番の定義と合わせ、明示の承認を得る。新しい処理は複合索引に頼らない形にしている。
- Firestore のトランザクションでは書き込みの前にすべて読み取る。監査ログなどに `undefined` を書かない（書き込みが失敗する）。
- ビルドとテスト：`functions` で `npx tsc --noEmit -p .` と `npx jest --config jest.config.js`、`src` で `npx ng build --configuration development`（以前からの警告 NG8011 が出る）。
- 開発サーバー：`.claude/launch.json` の `angular-dev`（本番の Firebase に接続。ポートが埋まっていると 4203 などになり、ログインし直しが必要）。
- 画面確認の注意：ブラウザーペインの日本語の自動入力は Angular に伝わらないことがある（`form_input` を使う）。`window.confirm` はペインで押せない。共通部品を変えると開発サーバーが画面を読み込み直し、画面内の状態が消える。
- 一部のファイルは改行が CRLF になっている。スクリプトで置換するより Edit ツールを使う。

## 8. 関連文書

| 文書 | 内容 |
|---|---|
| `docs/roadmap.md` | 段階0〜10の手順と終わりの条件（正） |
| `docs/catalog-checklist.md` | カタログ各項目の状態と担当段階、後続課題 |
| `docs/catalog-gap-analysis.md` | 初回の乖離分析（段階1以前） |
| `docs/ux-one-way-plan.md` | 一本道UI・大人数対応の方針 |
| `docs/screen-restructure-*.md`、`work/*.md` | 旧計画・旧引継ぎ（参考のみ） |
