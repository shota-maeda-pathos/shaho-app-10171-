# 引継ぎ（最新）

更新：2026-10-30（段階7.5 着手：共通部品・賞与・入社を作り直した。段階7を終えた：7-1 届出の横断一覧、7-2 模擬電子申請と紙の提出、7-3 承認の横断機能、7-4 賞与不支給報告書、7-5 訂正届・取消届、7-6 添付書類、7-7 保存原本とZIP。方針は `docs/stage7-plan.md`。**次は段階7.5（UI統一）**：着手の前に「6. 次にやるべきタスク」の「段階7.5 の着手メモ」を読む）。新しいセッションは最初にこのファイルを読む。応答は日本語で行う。

## 1. 目的と前提

- 目標：`C:\Users\pluser1\Desktop\社会保険管理システム 機能カタログ ちょーろんぐばーじょん.txt`（機能カタログ第2版）どおりに作り、労務担当の初心者でも迷わず使え、大人数の企業にも対応する。迷ったらカタログを正とする（ユーザー手元の設計書 `Downloads/screen-flow.md` 等はカタログと差がある）。
- 構成：Angular（`src/`）＋ Cloud Functions 2nd Gen（`functions/`、Callable・Zod）＋ Firestore。Firebase プロジェクト `kensyu10171`（本番だがデータはテスト用のみ）。Firestore も関数も **asia-northeast1**（東京。2026-10-30 に移転。リージョンは `functions/src/config.ts` の `setGlobalOptions` で一括指定し、関数ごとに書かない。画面は `app.config.ts` の `getFunctions(getApp(), 'asia-northeast1')`）。`functions/src/index.ts` は関数のモジュールを呼ばれたときに読み込む（`lazy`）。新しい関数はここに `lazy(() => require(...), [名前])` で足す（`index.test.ts` が名前の誤り・載せ忘れ・リージョンを確かめる）。
- GitHub：`shota-maeda-pathos/shaho-app-10171-`（公開）。最新コミットは `git log` で確認する。push はユーザーがアプリ外の PowerShell で行う。

## 2. 経緯（要約）

1. 以前は機能を横に広げて作ったが、どの業務も最後まで通らず計算誤りも多かった。2026-10-29 にカタログとの乖離を洗い出し、`docs/roadmap.md`（段階0〜10）に一本化した。
2. 段階0：独立リポジトリ化、チェックリスト `docs/catalog-checklist.md` 作成。
3. 段階1：法令計算をサーバーの純粋関数 `functions/src/insurance/calculator/` に集約（端数処理・等級表・支払基礎日数・随時改定・免除・得喪・適用判定）。
4. 段階2：共通UI部品 `src/src/app/shared/ui/`（ウィザード・対象者一覧・状態色・用語集・デザイントークン）。
5. 段階3：入社（個人型の見本）`/onboarding`。招待→本人入力→台帳→雇用条件→資格取得届・承認→提出→完了を画面で確認。
6. 段階4：毎月の処理（一括型の見本）`/monthly`。300名・2か月分で最後まで通した（下記）。途中で本番の料率マスタの単位誤りを発見・修正した。
7. 段階5：ホームとナビ。やることリスト・ライフイベントのカード・サイドバー5項目（下記）。
8. 段階6（途中）：退職のウィザード `/resignation/:id`、扶養のウィザード `/dependents/:id`、産休・育休のウィザード `/leaves/:id`、算定基礎届（一括型）`/santei`、賞与（一括型）`/bonus`、随時改定・終了時改定のウィザード `/revisions/:id`、年齢到達のウィザード `/age-events/:id`（下記）。いずれも承認・模擬電子申請・完了まで画面で確認した。

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
- サーバー `functions/src/home/`：`homeTodos`。
  - 入社：ウィザードの今のステップから次にやることを出す。期限は資格取得届の期限。本人の入力待ち・承認待ち（自分が依頼したものは待ち）・差し戻しの理由を出す。
  - 退職・扶養：`wizardTodo`（ウィザードの今のステップ・承認待ち・差し戻し・返戻と届出の期限）。それ以外の手続き：返戻→進行中→着手可能の順で最初のステップ（ウィザード化するまでの仮。`procedureTodo`）。
  - 毎月の処理：事業所ごとに当月分と、前後の月で始めて終わっていないもの。`monthlyOverview` を呼び、**画面と同じ判定**（`home/monthly-progress.ts` の `stepTone`、画面の `monthly.types.ts` の `stepState` と対応。判定を変えるときは両方を直す）で次のステップと残り人数を出す。期限は給与の支給日（`paymentDay`）。最初は最後の一括処理から推測したが、承認一覧で承認した場合などに誤ったため改めた。
  - 承認者だけの人には「あなたの番」だけを返す。読み込みは約5秒（事業所×月ごとに全員分を読むため）。
- ライフイベントのカード `features/procedures/life-events.ts`（9種）をホームと `/procedures/new` で共通に使う。従業員を選ぶ業務はカードの下で従業員を選ぶ。退職・扶養はウィザードへ、休業・異動はまだ従業員詳細へ進む。
- サイドバーの選択表示は URL から1つだけ決める（`layout.ts` の `activeRoute`）。旧 `/operations` は `/procedures/new` へ転送し、画面のファイルは削除した。

## 4-3. 重要な仕様（段階6 退職）

- 入口：「人が退職する」のカード（`procedure-start.ts` で従業員を選ぶ）と、従業員詳細の「退職」ボタン（`?action=loss` も同じ）。どちらも `resignationStart` で手続きを作ってウィザードを開く。同じ人の進行中の退職手続きがあればそれを開く。従業員詳細の旧い退職パネル（`employeeResign` を直接呼ぶ）は削除した。`employeeResign` 関数自体は残っている。
- サーバー `functions/src/resignation/`：`resignationStart`・`resignationGet`・`resignationPreview`（kind: entry／settlement）・`resignationUpdate`（step: entry／settlement／account／filing／complete）。手続きは `procedureType: 'loss'` に `resignation` の状態を持つ（旧方式の退職手続きにはない）。ステップは `templates.ts` の `RESIGNATION_STEPS`。
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

## 4-5. 重要な仕様（段階6 産休・育休）

- 入口：「産休・育休に入る／戻る」のカード（`procedure-start.ts` で従業員と休業の種類を選ぶ）と、従業員詳細の「休業」タブの「産休の手続きを始める」「育休の手続きを始める」。同じ人の進行中の同じ種類の手続きがあれば、それを開く。産休は女性だけ。社会保険に加入していない人は始められない。「休業」タブの旧い登録フォームは介護休業だけにした（`leaveCreate` は介護用に残る）。
- 1つの休業につき1つの手続き（`procedureType: 'maternity_leave'／'childcare_leave'` に `leaveProcedure` の状態）。ステップは `LEAVE_WIZARD_STEPS`：期間を決める→申出書を作る→承認→提出→休業中のことと復帰を記録する（`during`）→完了。
- サーバー `functions/src/leave-procedure/`：`leaveProcedureStart`・`leaveProcedureGet`・`leaveProcedurePreview`（期間・休業中のことの判定。保存しない）・`leaveProcedureUpdate`（step: plan／filing／event／complete）。
- 判定は `leave-procedure/rules.ts`（純粋関数・テストあり）：産前42日（多胎98日）・産後56日、休み始める日の範囲、子が1歳・1歳6か月・2歳・3歳に達する日（延長の区切り）、本人が出産した子は産後56日の後から、免除の月（月末・14日）と賞与の免除、産休の届出の期限（終了から1か月）、育休は「速やかに」、復帰した月。
- 休業中のこと（`judgeLeaveEvent`）：産休は出産日（予定日と違えば変更届。出産後に申出書を出していれば不要）と終了（予定より早ければ終了届。産後6週間は休む）。育休は延長（申出書（延長））と終了（早ければ終了届）。**予定どおりの終了は届出不要**。届出が要るときは届出のステップ（作る・承認・提出）をリセットして同じ手続きでもう一度通る。提出済みの届出は `history`。承認を依頼する前なら、届出のステップの「記録を直す」から記録をやり直せる（記録前のステップと参照を `pending` に持って戻す）。
- 届出の種類：産休の変更届・終了届は同じ様式の新しい種類 `maternityLeaveChange`（産前産後休業取得者変更（終了）届）。育休の延長は `childcareLeaveStart`（区分＝延長）、終了は `childcareLeaveEnd`。
- **免除**：申出書を作るときに休業（`leaves`。`procedureId` を持つ）と免除（`premiumExemptions`、`status: 'pending'`・`filingId`・`leaveId`）を作る。毎月・賞与の計算（`decideExemption`）は、`pending` でも `filingId` の申出書が承認済みなら免除する（以前の「承認しても免除が効かない」不具合の修正）。ウィザードを開くと免除を `active`・`approvedAt` に書き換える。休業中のことを記録すると、休業の期間と免除の月を合わせ直す。免除の前に免除なしで計算済みの月があれば、毎月の処理で計算し直すよう案内する（自動では計算し直さない）。
- 完了：復帰後の終了時改定の案内（復帰した月から3か月の給与）と等級の見直し画面へのリンク。産休の完了後は「育休の手続きを始める」で、子・開始日（産休の翌日）・終了予定日（1歳に達する日）を引き継ぐ。
- ホーム：`home/service.ts` の `leaveTodo`。休業中は「待ち」で、期限は終了予定日（出産前は「出産したら出産日を記録する」）。

## 4-6. 重要な仕様（段階6 算定基礎届）

- 一括型。単位は **事業所×年**（`santeiRuns/{officeId}_{year}`。保留 `holds/`・決め方 `decisions/`・届出 `filings/`）。画面 `/santei?officeId=&year=`（admin・operator・approver）。入口はライフイベントのカード「年1回の算定基礎届（7月）」とホームのやること。旧 `santei-list`・`santei-detail` 画面は削除した。
- 4ステップ：対象者を確かめる → 等級の承認 → 算定基礎届を作る → 届出の承認と提出。各ステップの状態は画面の `santei.types.ts` の `stepState` とサーバーの `santei/progress.ts` の `santeiStepState` が同じ判定（変えるときは両方を直す）。ホーム（`home/service.ts` の `santeiTodos`）は `santeiProgress` を使い、6月1日〜7月10日は始めていなくても、それ以外は始めた年だけ出す。期限は7月10日。
- 判定 `santei/santei-calc.ts`（純粋関数・テストあり）：4〜6月に**支払った**承認済みの給与（`salaries/{支給月}`）。除外（適用外・6月1日以降の取得・7月1日までの喪失・7〜9月の随時改定の等級あり）、保留（給与の未登録・未承認）、決め方が必要（支払基礎日数の基準を満たす月がない。一般17日・パートは17日がなければ15日・短時間11日）。決め方は「従前の標準報酬月額で決める」（今の等級がある人だけ）。資格取得前の月は使わない。遡及差額は判定から除き、届出の通貨には含める。4月1日〜7月1日に在籍していない人は一覧に出さない。
- サーバー `functions/src/santei/`：`santeiRunOverview`（全員分、上限3000名）・`santeiRunHold`・`santeiDecision`・`santeiJobStart`／`santeiJobGet`／`santeiJobChunk`（`santeiJobs/{id}/chunks` を東京のトリガーで25名ずつ。毎月の処理と同じ作り。`authOf`・`getAllChunked` は `monthly/service.ts` から使う）・`santeiFilingCreate`・`santeiFilingUpdate`・`santeiFilingGet`・`sampleSanteiCreate`。
- 等級の承認は既存の承認申請（`requestType: 'grade'`、対象は `grades/{年}-09`、`targetVersion: 0`）。メタデータに月ごとの値・使った月・区分・従前の等級と改定月を残す。承認する直前にサーバーで判定し直し、内容が変わっていれば承認しない（差し戻して出し直す）。9月の等級が定時決定以外で既にあれば依頼・承認しない。承認一覧からの個別承認もできる（その場合は再判定しない）。
- 届出は承認された等級の申請内容から作る（`santeiFilingPerson`：総計・平均額は基準を満たした月の支払額、遡及支払があれば修正平均額、備考の番号 1・4・6・7・9 と「その他」の文言）。1件に1000名まで。届出は従業員の下ではなく `santeiRuns/.../filings` にあり、状態は 下書き→承認待ち→承認済み→提出済み（取り消し・差し戻しは下書きへ）。届出の承認は依頼した人以外の管理者・承認者。**届出一覧・承認一覧には出ない**（段階7で横断機能に入れる）。番号は取り消した届出も数える。
- PDF（画面）`official-filing-pdf.ts` の `createSanteiFilingPdf`：公式様式に1枚5人（行の間隔155）。様式の MediaBox の原点は (-8.39, 8.39) のため、pdf.js で測った位置には 13.4 を足して使う。遡及支払額の欄・事業所整理記号・被保険者整理番号（未登録なら）は空欄で警告を出す。
- 旧 `santeiPreview`・`santeiSubmit` はコードから外したが本番に残っている（削除は要確認）。`filing-auto-generate` の算定基礎届（1人ずつ・17日だけの判定）も残っているが、画面からは使っていない。

## 4-7. 重要な仕様（段階6 賞与）

- 一括型。単位は **事業所×賞与の支給月**（`bonusRuns/{officeId}_{yyyy-mm}`。保留 `holds/`・届出 `filings/`。不支給報告書の記録 `nonPayment`）。画面 `/bonus?officeId=&month=`（admin・operator・approver）。入口はライフイベントのカード「賞与を払った」とホームのやること。旧 `/premium/bonus` は `/bonus` へ転送し、旧画面 `premium-bonus` は削除。従業員詳細の賞与タブは見るだけにした（旧 `bonusCreate`・`bonusUpdate` は画面から使っていないが本番に残る）。
- データ：`employees/{id}/bonuses/{支給月}` のまま（承認申請の決まったID `bonus-{月}-v{版}`・`bonusInsurance-{月}-v{版}` と互換）。`payments: [{date, cash, inKind}]` を足し、同じ月の支給は合算（`totalAmount`・`standardBonusAmount`＝合算額の千円未満切捨て・`paymentDate`＝初回の支給日）。旧データ（payments なし）は支給日なしの1回として読む。
- 判定 `bonus/bonus-calc.ts`（純粋関数・テストあり）：年度（4月始まり）、同月合算、上限（健保は年度累計573万円・厚年は月150万円）と上限に近い（8割超）知らせ、保険料と届出の要否（支給日で資格を判定。資格喪失月で喪失日より前の支給は「保険料なし・届出あり」、喪失日以後・適用外・取得前は届出不要）、年度の4回目（支給日ごと）の警告、届出の1人分（備考1＝70歳以上被用者・3＝同一月内の賞与合算と初回支払日）、期限（初回の支給日＋5日）、CSV（同じ人の複数行＝同月の別の支給。誤りのある人は全行取り込まない）。
- `bonusInsuranceCalculate` を直した：健保の年度累計を**前の月の承認済みの標準賞与額からサーバーで数える**（手入力の `cumulativeBonusAmount` は使わない。前の月に未承認の賞与があれば計算しない）。資格喪失月は0円、届出不要の人は計算しない。計算結果に `priorCumulativeBonusAmount`・`bonusTarget` などを残し、年度累計が変わったら「計算し直し」にする。
- 4ステップ：賞与を登録する（CSVファイル・**表の貼り付け**・1人ずつの入力。2回目の支給は1人分の入力で足す）→ 賞与額の承認 → 保険料の計算と承認 → 賞与支払届（作成・承認・模擬電子申請／紙）。各ステップの状態は画面の `bonus.types.ts` の `stepState` とサーバーの `bonus/progress.ts` の `bonusStepState` が同じ判定（変えるときは両方を直す）。
- サーバー `functions/src/bonus/`：`bonusRunOverview`（全員分、上限3000名）・`bonusRunHold`・`bonusRunImport`（dryRun あり）・`bonusRunEntry`・`bonusRunNonPayment`・`bonusJobStart`／`bonusJobGet`／`bonusJobChunk`（`bonusJobs/{id}/chunks` を東京のトリガーで25名ずつ。操作は賞与額の承認依頼・承認、保険料の計算・承認依頼・承認）・`bonusFilingCreate`・`bonusFilingUpdate`・`bonusFilingGet`・`sampleBonusCreate`。承認依頼した人は run の `bonusReview`・`premiumReview` に残し、承認者には「あなたの番」で出す。
- 届出は算定基礎届と同じ作り（`bonusRuns/.../filings`、1件に1000名まで、状態は 下書き→承認待ち→承認済み→提出済み、届出一覧・承認一覧には出ない）。PDF（画面）`official-filing-pdf.ts` の `createBonusFilingPdf`：1枚10人（行の間隔 77.87＝原票160%の値）、共通の支払日を各ページに書き、各行の支払日は共通と違うときだけ書く。個人番号（70歳以上被用者）の欄は書かず警告を出す。
- 不支給：事業所の `bonusMonths`（設定の事業所一覧で登録。`officeList` が返すようにした）。予定月が終わって賞与が1件もなく、不支給報告書の提出日の記録もなければ、賞与の画面とホームに「賞与不支給報告書の提出が必要です」。報告書そのものの作成は段階7。
- ホーム：`home/service.ts` の `bonusTodos`。始めた支給月（半年以内）で終わっていないものと、過去3か月の予定月の不支給。期限は賞与支払届の期限。

## 4-8. 重要な仕様（段階6 随時改定・終了時改定）

- 個人型。1つの手続きは `procedureType: 'monthly_change'` に `gradeRevision` の状態（種類 `occasional`／`maternityEnd`／`childcareEnd`・起点の月・決めた判定 `decision`・届出・対象外で終えた理由）。ステップは `REVISION_WIZARD_STEPS`：変動を確かめる（終了時改定は休業の終わりと申出）→判定する→届出を作る→承認→提出→完了。
- 入口：ライフイベントのカード「給料が大きく変わった」（`procedure-start.ts` で従業員と「見直しのきっかけ」を選ぶ）、従業員詳細の「随時改定」ボタン、産休・育休の完了画面の「終了時改定の手続きを始める」（休業を終えた日・子を引き継ぐ。`sourceProcedureId`）、毎月の処理の詳細の「随時改定の対象か確かめる」（変動月を引き継ぐ）、ホームのやること。いずれも `/revisions/new?employeeId=&kind=&startMonth=&sourceProcedureId=` を開き、画面が `gradeRevisionStart` を呼んで手続きの画面へ移る（同じ人の進行中の同じ改定があればそれを開く）。旧 `/employees/:id/revision` はここへ転送し、旧画面と旧 `gradeRevisionCheck`・`gradeRevisionSubmit` はコードから外した（本番には残る）。
- サーバー `functions/src/grade-revision/`：`gradeRevisionStart`・`gradeRevisionGet`・`gradeRevisionPreview`（入れかけの内容で判定。保存しない）・`gradeRevisionUpdate`（step: change／decide（revise・close）／filing／complete）・`sampleRevisionCreate`。判定は毎回 `evaluate`（給与・改定前の等級・料率の等級表を読む）を通し、届出を作る直前にも判定し直して、決めた内容と違えば作らない。新しい等級を使う月に別の決定の等級があれば止める。
- 判定 `grade-revision/rules.ts`（純粋関数・テストあり）：随時改定は変動月と前月の固定的賃金（前月の給与がなければ `previousTotalFixedWage`、なければ担当者が向きを選ぶ）、3か月とも承認済み・支払基礎日数（一般17日・短時間11日）、遡及差額を除いた平均、健保・厚年別に2等級差（上限・下限の特例。従前の報酬月額は担当者の入力か等級の `basisRemuneration`）と向きの一致。終了時改定は休業を終えた日の翌日が属する月から3か月、基準に満たない月を除く（パート15日の特例）、1等級差、本人の申出・子が3歳未満・翌日から次の休業に入らない。どちらも4か月目から適用。
- 承認は届出の1回（入社と同じく承認申請の `metadata.grade`）。承認で届出が承認済みになり、等級（`grades/{適用月}`、`determinationType: occasional／leaveEnd`、`basisMonths`、`filingId`）が確定する。`approvalRequestApprove` を直した。改定前の等級で計算済みの月があれば、完了画面で計算し直しを案内する（自動では計算し直さない）。
- 毎月の処理：`monthlyRunOverview` が支給月を3か月目とする人（変動月＝支給月の2か月前）について固定的賃金の変動を見て判定し、行に `revision`（知らせ・手続き）を返す。手続きを始めるまでは注意（`warnings`）に出す（「結果の確認」のステップで「確認が必要」）。対象の人には「給与と等級の開き」の注意は出さない。
- 届出：④ `remunerationMonthlyChange`（既存の様式）、⑪ `maternityLeaveEndChange`・⑫ `childcareLeaveEndChange`（新規。公式様式 `src/public/filing-forms/maternity-end-change.pdf`・`childcare-end-change.pdf`、出所は `sources.json`。記入は `official-filing-pdf.ts` の `leaveEndRemuneration`。2つの様式は同じ並びで育休は10px左）。期限は「速やかに」。
- ホーム：`home/service.ts` の `revisionTodo`。3か月目の給与の月が来るまでは「待ち」。

## 4-9. 重要な仕様（段階6 年齢到達）

- 40・65歳は届出がないため手続きを作らない。介護保険料は毎月の計算が年齢から自動で変える（前月差額の理由に「介護保険の開始・終了」が出る）。70・75歳は個人型のウィザード（`procedureType: 'age_event'` に `ageEvent` の状態。1人に1回なので、同じ種類の手続きがあれば終えたものも開く）。ステップは `AGE_WIZARD_STEPS`：到達日と届出の要否を確かめる→届出→承認→提出→完了。
- 判定 `age-event/rules.ts`（純粋関数・テストあり）：到達日＝誕生日の前日。70歳は到達日に厚生年金を喪失し、到達日の月の前月分まで。75歳は誕生日当日に健康保険を喪失し、誕生日の月の前月分まで。届出の期限は起きた日から5日。70歳は「標準報酬月額相当額」（到達日の報酬月額を厚年の等級表に当てはめる）が到達前の厚年の標準報酬月額と同じなら届出不要（様式にも「従前額と異なる場合に提出」とある）。報酬月額の目安は直近の固定的賃金＋3か月の非固定的賃金の平均で、担当者が直せる。健康保険の等級は変えない。
- 保険料の月ごとの年齢の扱いは `calculator/age.ts` の `ageFlagsForMonth`（日付で判定）に一本化し、`utils/age.ts` の `isHealthExcluded` などはその包み。以前は75歳の誕生日が月の1日の人の前月分の健保を外していた。
- サーバー `functions/src/age-event/`：`ageEventStart`・`ageEventGet`・`ageEventPreview`（70歳の届出の要否。保存しない）・`ageEventUpdate`（step: check／filing／complete）・`sampleAgeCreate`。届出が要らない70歳は届出のステップを `skipped` にし、完了は手続き側で閉じる。75歳は被扶養者（`dependents`）も外れることを案内し、保険証などの回収枚数を入れる。台帳（雇用条件の加入）は書き換えない（計算は年齢から判定するため）。
- 届出：75歳は `lossNotification`（喪失原因「75歳到達」→ 様式の「7.」に丸）。70歳は新しい種類 `pensionLoss70`（公式様式 `src/public/filing-forms/pension-loss-70.pdf`、出所は `sources.json`。喪失原因「6. 70歳到達」は様式に印刷済み。記入は `official-filing-pdf.ts` の `pensionLoss70`）。
- 入口：ライフイベントのカード「70歳・75歳になる」（`procedure-start.ts` で従業員と年齢を選ぶ）、ホームのやること（`/age-events/new?employeeId=&kind=` を開くと手続きを作る）。ホーム：`home/service.ts` の `ageNoticeTodos`（まだ始めていない到達）と `ageTodo`（手続き）。従業員を全員読む（`select` で生年月日などだけ）。

## 4-10. 重要な仕様（段階6 雇用条件の変更・有期雇用・二以上事業所・事業所間異動）

- 雇用条件の変更 `/employment-changes/:id`（`procedureType: 'employment_change'` に `employmentChange`）：新しい条件を入れる→承認者が雇用条件を確認する→届出→承認→提出→完了。サーバー `functions/src/employment-change/`（`employmentChangeStart`・`Get`・`Preview`・`Update`（entry／filing／complete）・`sampleChangeCreate`）。判定は入社の `evaluateContract` を新しい条件の初日で使う。保存すると `employments` に **effectiveDate を持たない下書き**（`plannedEffectiveDate`）を作り、`requestType: 'employment'` で承認を依頼する（日付で探す計算・判定から見えない）。承認されたら、次に手続きを開いたときに effectiveDate を付けて有効にし、従業員の `contract` を書き換える（`applyIfApproved`）。加入が切り替われば資格取得届（取得日＝初日、`metadata.grade` で資格取得時決定）・資格喪失届（喪失日＝初日の翌日、健康保険法第36条）。雇用条件の承認のステップは type を data_entry にしてある（approval にすると届出の承認と混ざる）。入口は従業員詳細の「雇用条件を変える」と、有期の満了の案内の「契約を更新する」（`reason: 'renewal'`）。
- 有期雇用：`createEmployment` が契約を従業員に写す（`contract: {type, endDate, renewalExpected}`）。ホームの `contractTodo`（従業員を読む `ageNoticeTodos` の中で、先月〜来月末の満了）。従業員詳細に満了の案内。
- 二以上事業所：`employeeOtherEmployerSet` で従業員に `otherEmployer` を記録（保険料・届出は変えない）。`employeeGet`・`monthlyRunOverview`（行の `otherEmployer`）・各ウィザードの取得で返し、警告を出す。
- 事業所間異動 `/transfers/:id`（`procedureType: 'transfer'` に `transfer`）：異動先と異動日→台帳の所属事業所を変える→資格喪失届・資格取得届を出す→完了。サーバー `functions/src/transfer/`（`transferStart`・`Get`・`Preview`・`Update`（entry／apply／complete））。届出は2件で、届出の画面で承認・提出し、手続きは2件とも提出済み（模擬申請の完了か紙の受理）になると次へ進む。取得届の等級は今の等級を引き継ぎ、届出の承認で異動月の等級として確定。従業員詳細の旧い異動パネル（`employeeTransfer`）はボタンから外した（関数は残る）。
- 届出の画面の模擬申請・提出記録は確認ダイアログを通るため、ブラウザーペインでは押せない（今回は関数を直接呼んで確かめた件がある）。
- 従業員詳細：等級履歴に「根拠・届出」（`employeeHistoryList` が `basisRemuneration`・`filingId` を返す）、扶養家族に「扶養から外れた日」。

## 4-11. 重要な仕様（段階7 届出の横断一覧）

- 方針と順番は `docs/stage7-plan.md`（ユーザー承認済み）。段階7は完了（2026-10-30。12種のうち⑦以外は✅、⑦の残りは段階9の本人ポータルからの申請）。次は段階7.5（UI統一）。
- 届出の索引 `companies/{c}/filingIndex/{source}_{親ID}_{届出ID}`：従業員の下・`santeiRuns`・`bonusRuns` の届出の書き込みを、トリガー `filingIndexEmployee`・`filingIndexSantei`・`filingIndexBonus`（asia-northeast1）が受けて更新する。中身は `filings/index/rules.ts`（純粋関数・テストあり）：カタログの状態名（draft・rejected・pending・approved・sent・received・processing・completed・mockFailed・returned・cancelled）と紙の提出 `paperStatus`、未提出 `open`、期限 `deadline`（種類ごとに計算。「速やかに」は `deadlineNote`）、受付番号、作成日・提出日。**7-2 で状態の持ち方を変えるときは `employeeFilingStatus`・`runFilingStatus` も直す。**
- 検索 `filingSearch`（admin・operator・approver）：等価条件を1つだけ Firestore に渡し（複合索引なし）、残りは関数内で絞る。上限5000件を読む。未提出・期限超過・7日以内・承認待ちの件数を返す。旧 `filingList` は画面から使わなくなった（関数は残る）。
- 移行 `filingIndexRebuild`（管理者）：全届出を索引に入れ直し、元のない索引を消す。2026-10-30 に実行（34件）。順に読んでいたため約4分かかったので並行読み込みに直した（7-2 でデプロイ済み）。
- 期限の休日延長 `insurance/calculator/holidays.ts`：祝日・振替休日・国民の休日・12月29日〜1月3日。`fiveDayDeadline`（5日の期限）を入社・退職・扶養・年齢到達・賞与・雇用条件の変更・異動で使う。7-2 のデプロイで、使う関数をすべて再デプロイした。
- 届出一覧 `/filings`：最初は「まだ提出していない」を期限の近い順。カード4つ（未提出・期限超過・今週が期限・承認待ち）、種類・状態・紙の提出・氏名や社員番号・受付番号・期間で絞り込み。算定基礎届・賞与支払届の行は一括型の画面へ。旧「自動生成」ボタンは外した（`filingAutoGenerate` は残る）。表示名は `features/filings/filing-labels.ts`。
- 画面で確認（2026-10-30）：34件の表示、期限順、受付番号での検索（算定基礎届）、氏名・社員番号での検索、算定基礎届・従業員の届出の行から画面を開く。旧データには「差戻し＋紙で受理」など3軸の食い違いがそのまま出る。スマホ幅ではアプリ全体のサイドバーが畳まれず本文が狭い（共通レイアウトの既存の問題）。

## 4-12. 重要な仕様（段階7 提出：模擬電子申請と紙の提出）

- 状態は届出の `mock`（模擬電子申請）・`paper`（紙の提出）に持つ。純粋関数は `filings/submission/rules.ts`（テストあり）。従業員の届出には旧来の `mockStatus`（notStarted／sent／received／processing／completed／failed／returned）・`submissionStatus` などを、算定基礎届・賞与支払届には `status`（模擬の完了か紙の提出で submitted、送信中は approved のまま）と `submission` を写す（`employeeMirror`・`runMirror`）。段階7より前の届出は `stateOf` が旧来の項目から組み立てる。
- 模擬電子申請：送信済み→受付済み→処理中→完了。待ち時間は `settings/mockSubmission`（既定は各10秒、自動で進めない設定も可。設定画面の「模擬電子申請」タブ、変更は管理者）。受付済みになるときに `MOCK-YYYYMMDD-0001`（`counters/mock-YYYYMMDD` の日ごとの連番）。受付前だけ送信取消（承認済みに戻る）。エラーのシミュレーション4種（timeout・serverError・validationError・outOfHours）と必須項目の不足は送信エラーで、送り直せる。管理者は「次の状態へ進める」（以後は自動で進まない）と「返戻にする」（理由が要る）。返戻（模擬・紙）の後は「下書きに戻して直す」（`reopen`。従業員の届出は workflowStatus を draft、run の届出は status を draft）で承認からやり直す。完了・返戻はダッシュボードに通知。
- 紙の提出：提出日・提出先・方法（窓口／郵送）→ 受理（決定通知の内容）／返戻（理由）。模擬電子申請の完了後も記録できる。送信中は記録できない。
- 自動で進める仕組み：送信中の届出をルートの `mockSubmissionQueue`（`dueAt`）に置き、定期の関数 `filingMockAdvance`（asia-northeast1、1分ごと）が進める。画面が `filingSubmissionGet` で読むときも予定を過ぎていれば進める。自動で進めたときは届出の version を上げない。
- 関数：`filingSubmissionGet`・`filingSubmissionAction`（mockSend／mockCancel／mockAdvance／mockReturn／paperSubmit／paperResult／reopen）・`filingMockSettings`。旧 `filingMockSubmit`・`filingSubmit`・`filingRecordResult` は画面から使わなくなった（関数は残る）。
- 画面：共通の部品 `features/filings/submission/filing-submission.ts`（`<app-filing-submission [target]="{source, parentId, filingId}" (changed)="...">`）。7つのウィザードの提出ステップ・届出の画面・算定基礎届・賞与の届出で使う。確認は画面内（`window.confirm` を使わない）。送信中は3秒ごとに読み直す。
- 手続きの判定：`procedures/refresh.ts` の模擬申請のステップは送信中が進行中、返戻が差し戻し。算定・賞与の進み具合（`santeiProgress`・`bonusProgress`、画面の `filingTone`）は送信中を待ち、返戻・送信エラーを要対応にする。
- 画面で確認（2026-10-30、本番の関数）：高橋 三郎の資格取得届でタイムアウトのシミュレーション→送り直し→10秒ごとに完了（`MOCK-20261030-0001`）、取消ボタンが受付後に消える。兼業 六子（CHG-0006）の育休申出書を送信→完了（`-0002`）し、育休の手続きが「復帰を記録する」へ進んだ。自動の進行を止めて前田 翔太（TEST-111）の資格喪失届を送信→取消→紙で提出（品川年金事務所・窓口）→受理（決定通知の内容）。設定は自動・10秒に戻した。届出一覧・ホームへの反映も確認。
- 未確認：管理者の「次の状態へ進める」「返戻にする」と「下書きに戻して直す」（承認のやり直しに別アカウントが要る）、算定基礎届・賞与の届出での提出部品（提出済みの届出しかないため）、定期の関数だけで進むこと（画面を閉じた状態）。旧方式の「前田 翔太 退職手続き」は紙で受理しても、ホームに「模擬電子申請 申請可能」と出る（旧方式の手続きの以前からの作り）。ホームの初回読み込みがデプロイ直後に約30秒かかった。

## 4-13. 重要な仕様（段階7 承認の横断機能）

- 承認の索引 `companies/{c}/approvalIndex`：従業員の下の承認申請（トリガー `approvalIndexRequest`、asia-northeast1。ID `req_{従業員}_{申請}`）と、算定基礎届・賞与支払届の承認（届出の索引のトリガーが `syncRunFilingApproval` で合わせる。ID `{santei|bonus}_{run}_{届出}`。依頼前の下書きは載せない）。中身は `approvals/index/rules.ts`（純粋関数・テストあり）：依頼者の名前、要点（金額・等級・人数）、届出の期限、状態（pending／approved／rejected／cancelled）。移行 `approvalIndexRebuild`（2026-10-30 実行、2,991件）。
- 一覧 `approvalSearch`：承認待ちは件数で切らず、既定は届出の期限の近い順。カード（あなたが承認できる・期限超過・放置・自分の依頼）、種類・キーワード・並べ方。旧 `approvalRequestList` は画面から使わなくなった。
- 一括承認 `approvalBulkApprove`（admin・approver、200件まで）：1件ずつ `approveApprovalRequest`（通知なし）または算定・賞与の `approve` を呼び、失敗は理由を返す。監査ログ（entity `approvalBulk`）と通知を1件。画面は選んだ件の要点を一覧で見せてから実行。個別の承認も同じ関数を通す。
- 差分 `approvalDetailGet`：同じ targetPath の前回の申請の `snapshotData`（届出は formData）と項目ごとに比べる（`diffSnapshots`）。算定・賞与の届出は差分なし（一括型の画面で確かめる案内）。承認後の書き換え（`tampered`）と依頼後の変更（`changedSinceRequest`）を警告。
- 改ざん検知：届出の承認時に `approvedHash`（`utils/hash.ts` の `filingContentHash`。従業員の届出は filingType＋formData、run の届出は header＋persons）を届出と承認申請に残し、送信・紙の提出の前に照合して違えば止める。
- 承認取消 `approvalCancel`（届出だけ・理由必須・管理者／承認者／担当者）：送信中・完了・返戻、紙で提出済みは不可（訂正届）。従業員の届出は申請を cancelled、届出を draft、`metadata.grade` で作った等級（`approvalRequestId` が一致するもの）を削除、`premiumExemptions`（filingId）を pending に戻す。その等級・免除の月の `monthlyInsurance` があれば取り消さない。run の届出は status を draft・`approvalCancelledAt`。ホームは「〇〇の承認を依頼し直す」。
- 放置・リマインド：`settings/approval.staleDays`（既定3日、設定の「提出・承認」タブ）。`approvalReminder`（毎朝9時・東京）が期限超過・2日以内・放置の承認待ちを1日1回通知。サイドバーの「承認」に自分が承認できる件数のバッジ（`approvalBadgeGet`、1分ごとと画面移動で更新。リアルタイムではない）。差戻しの通知に理由を入れた。
- 画面で確認（2026-10-30）：移行後の承認待ち0件が旧関数と一致、処理済み800件の表示、岩貞 祐太（TEST-014）の資格取得届の承認を依頼すると一覧に「自分の依頼」で出て承認ボタンが出ない、中身の表示（初めての依頼）。承認者（金本 知憲）が一覧から承認 → 担当者が理由を入れて承認取消（一覧で「承認取消」、届出は下書き）→ 依頼し直すと「前回（承認取消）から内容は変わっていません」と経緯（依頼・承認者・取消の理由）が出ることを確認。岩貞の資格取得届は承認待ちのまま残っている（承認者の確認用）。**未確認**：一括承認（2件以上）・差戻し・バッジの数字・内容が変わったときの差分の強調・改ざんの警告・リマインドの通知・等級や免除を伴う届出の承認取消。

## 4-14. 重要な仕様（段階7 賞与不支給報告書）

- 公式様式 `src/public/filing-forms/bonus-non-payment.pdf`（日本年金機構「5-1」のページ、2026-10-30取得、出所は `sources.json`）。記入は `official-filing-pdf.ts` の `createBonusNonPaymentPdf`（提出日・整理記号4マス×2（灰色の2マスを空けて右寄せ）・事業所番号5マス・郵便番号・所在地・名称・事業主・電話・① 賞与支払年月（令和の年2桁＋月2桁）・③ 変更後／変更前（各4マス、月は2桁、支給しない場合は変更後をすべて「00」））。② 「1. 不支給」は印刷済み。
- 賞与の run の届出（`bonusRuns/{事業所}_{月}/filings`、`filingType: 'bonusNonPayment'`、人数0）。`bonusNonPaymentFilingCreate`：支給予定月で賞与が1件もない月だけ、1か月1件。③は `nonPaymentChangeOf`（keep／change（4か月まで）／remove）。承認・取消は `bonusFilingUpdate`、提出は共通の提出部品。期限は「速やかに」。
- 提出を終えると（模擬の完了か紙の提出）`afterBonusFilingSubmitted` が run に `nonPayment`（filingId つき）を書き、③の変更後の月を事業所の `bonusMonths` に反映する（一度だけ、監査ログあり）。
- 賞与の画面：月が終わっても賞与がない支給予定月に作成フォーム（提出日・③）。作った後は状態・変更内容・PDF・承認・提出。旧い「提出した日だけ記録する」も残す。賞与支払届の一覧・進み具合（`bonusProgress`）は bonusPayment だけを見る。
- 画面で確認（2026-10-30、サンプル賞与テスト事業所の2026年9月）：③を7・12月に変える報告書を作成→PDF（見本の整理記号などを入れて記入位置を確認）→承認を依頼→承認一覧に「事業所の報告（2026-09分）」→承認者（金本）が承認→模擬電子申請で完了（MOCK-20261030-0003）→事業所の支給予定月が7・12月に変わり、ホームの9月の不支給のやることが消えることを確認。**この事業所の支給予定月は7・12月になった**（9月はもう予定月ではない）。未確認：紙の提出・「今後は支給しない」の記入（単体の判定のみ）。サンプル賞与テスト事業所は整理記号・事業所番号・郵便番号が未登録（PDFに警告が出る）。

## 4-15. 重要な仕様（段階7 訂正届・取消届）

- 対象は従業員の下の届出だけ（算定基礎届・賞与支払届の訂正は未対応。1人分を取り出す作り方を決める必要がある）。判定は `filings/correction/rules.ts`（テストあり）。
- `filingCorrectionCreate`：提出済み（模擬の完了か紙で提出・受理）の届出から、同じ従業員の届出として `filingType: 'correction'｜'cancellation'`（`originalFilingId`・`originalFilingType`・`reason`・formData の写し）を作る。提出前の届出・取消済み・訂正届そのものからは作れない。同じ種類の作りかけがあればそれを返す。
- `filingCorrectionUpdate`（save／discard）：下書き・差し戻しのときだけ。直せるのは元の届出の配列でない項目（数値は数値に戻す）。保存のたびに元との差分を `corrections` に入れる（`diffSnapshots` を流用）。discard は workflowStatus を cancelled に。
- 承認は既存の承認申請（届出の画面の「承認申請」）、提出は共通の提出部品。送信前に理由と訂正箇所を確かめる（`correctionErrors`）。提出を終えると `afterCorrectionSubmitted` が元の届出に `cancelledAt`・`cancelledByFilingId`（取消）か `correctedByFilingIds`（訂正）を書く（一度だけ）。索引では取消した元の届出が「取消」になる。
- PDF：`createCorrectionPdf`（元の様式に記入＋1枚目上の余白に赤枠「訂正届」「取消届」＋最後に理由と訂正箇所の一覧ページ）。フォントを2回埋め込むため約7MB。
- 画面：届出の画面に「提出したあとに誤りが見つかったら」（訂正届・取消届を作る）、訂正届の画面に元の届出・理由・訂正箇所・記入の直し・取り下げ、元の届出に訂正・取消のリンク。台帳・等級は自動で直さず従業員の画面へ案内。
- 画面で確認（2026-10-30）：高橋 三郎の資格取得届（提出済み）から訂正届を作成→報酬月額（通貨・合計）を220,000に直して保存→訂正箇所2件→PDF→承認を依頼→承認一覧に「訂正届・速やかに」→承認者（金本）が承認→模擬電子申請で完了（MOCK-20261030-0004）→元の資格取得届に「この届出には訂正届を出しています」のリンクが出ることを確認。未確認：取消届の流れ（単体の判定のみ）・紙での提出。

## 4-16. 重要な仕様（段階7 添付書類）

- Cloud Storage の既定のバケット `kensyu10171.firebasestorage.app`（もともとあり、画面からの直接の読み書きはルールで拒否）に、関数だけが書く（2026-10-30 ユーザー承認）。置き場所は `{届出のパス}/attachments/{ID}/{ファイル名}`、一覧は届出の下の `attachments`（名前・種類・大きさ・必要書類の key・添付した人と日時・`deletedAt`）。
- 判定 `filings/attachments/rules.ts`（テストあり）：PDF・JPEG・PNG を中身の先頭のバイトで判定、1ファイル5MB・1件20ファイルまで、ファイル名の危ない文字を置き換え。必要書類のチェックリスト `attachmentChecklist`（取得届の継続再雇用、喪失届の保険証、扶養の続柄・収入・仕送り（別居は原則必要）・住民票（その他の親族）・外れる人の保険証、月額変更届・終了時改定の賃金台帳と出勤簿（60日以上さかのぼる・5等級以上下がる）、訂正届・取消届の理由が分かる書類）。
- 関数：`filingAttachmentList`（admin・operator・approver）・`filingAttachmentUpload`（base64、7.2MBまで）・`filingAttachmentGet`（base64 で返す）・`filingAttachmentDelete`。対象は提出の部品と同じ `{source, parentId, filingId}` で、3か所の届出のどれにも付けられる。提出を始めた（送信中・完了・紙で提出・受理）あとは追加・削除できない。
- 提出の部品：`filingSubmissionGet` が `attachmentWarnings`（原則必要で添付のない書類）を返し、送信・紙の提出の前に警告する（止めない）。
- 画面：共通の部品 `features/filings/attachments/filing-attachments.ts`。届出の画面（「添付書類」のカード）、算定基礎届・賞与の届出のカード（折りたたみ）。削除は `shared/confirm-dialog`。
- 画面で確認（2026-10-30、森下 翔太の月額変更届・下書き）：チェックリスト（賃金台帳・場合により必要）、テスト用PDFの添付（本番のバケットへの書き込み）、関数での取得（同じPDFが戻る）、中身がPDFでないファイルの拒否、確認ダイアログからの削除。未確認：原則必要な書類が足りないときの提出前の警告（扶養の別居など。単体の判定のみ）、算定・賞与のカードからの添付、承認者の閲覧。

## 4-17. 重要な仕様（段階7 保存原本とZIP）

- 承認したとき（`approveApprovalRequest` の届出、算定基礎届・賞与の `approve`）に、届出の下の `archives` に保存原本を追記する（`filings/archive/rules.ts` の `buildArchive`、テストあり）：記入内容（formData か header＋persons）・訂正箇所と理由・PDFの事業所欄の情報（承認時点の会社・事業所）・内容の指紋・様式の版（`FORM_VERSIONS`。`src/public/filing-forms/sources.json` とテストで突き合わせる。様式を差し替えたら両方を直す）。承認の取消でも消さない。
- 関数：`filingArchiveList`・`filingArchiveGet`（最新か指定の原本）・`filingArchiveBatch`（ZIP 用。届出の索引から、承認済み以降・紙で提出の届出を期間（提出日／作成日）・種類・事業所で選び、1回20件ずつ。原本のない届出（7-7 より前に承認）は今の内容を `current` で返す）。
- 画面：`features/filings/archive/archive-pdf.ts`（原本から種類ごとに PDF を作る。同梱の様式の版が変わっていれば警告）、`zip.ts`（依存なしの格納形式の ZIP、UTF-8 のファイル名、同名は「(2)」）。届出の画面に「保存原本」（承認ごとに「このときのPDF」）、届出一覧に「PDFをまとめて保存する（ZIP）」。
- 画面で確認（2026-10-30）：2026年10月の提出33件をZIP（38秒、全件「今の内容」）、森下 翔太の月額変更届を承認→原本ができて「このときのPDF」、承認の取消後も原本が残る。**課題**：ZIPが約150MB（PDFごとに日本語フォントを丸ごと埋め込むため。算定基礎届270名で28MB）。フォントを使う文字に絞れば小さくなるが、以前「CJKの絞り込みで文字が抜ける」として丸ごとにした経緯があり、ユーザー判断待ち。
- あわせて直したこと：承認の一覧で、処理した案件を索引が追いつくまで外し3秒後に読み直す（「読み込み直す」を押さないと消えなかった）。上で事業所を選んでいると一覧はその事業所だけだがバッジは全事業所の件数だったため、ほかの事業所の承認待ちの件数を出し、その場で「すべての事業所を表示」できるようにした（`approvalSearch` の `summary.elsewhere`）。送信エラーのまま紙で提出した届出は、索引の状態に送信エラーを出さない。
- 確認できたこと：一括承認（2件以上、金本）、紙の提出→受理（森下の月額変更届・西宮年金事務所）、取消届を紙で提出→元の届出が「取消」（坂本 誠志郎の資格取得届。古い形式の届出で被保険者氏名がないため模擬電子申請は送信エラーになる）。差戻しは確認待ち（斎藤 修の訂正届に「【差し戻してください】」で依頼中）。

## 4-18. 重要な仕様（段階7.5 UI統一。途中）

- 設計は `docs/ui-unification-design.md`、進み具合はチェックリストの末尾「段階7.5」。
- 共通部品 `shared/ui/procedure-frame.ts`：`app-page-head`（種類のタグ・件名・[meta]・[actions]・戻るリンク）、`app-stepper`（`StepperItem` の state は done／attention／waiting／todo、note は数字1つ）、`app-step-lead`（見出し＋やることの1行）、`app-action-bar`（sticky で下に固定。info・注意の1行・主ボタン）、`app-side-panel`（右から重なるパネル、前後・Esc・矢印キー）。`app-wizard` は API をそのままにこれらで描く（`WizardStep` に caution・attention・note を足し、why・next は画面に出さない）。`app-target-list` はチップ（要対応・保留・問題なし・すべて）と検索、`appTargetDetail` を渡すと名前で右のパネル、渡さなければ open。一括操作 `BulkAction` に caution（操作バーの注意）と confirm（確認ダイアログ）。ページ独自のボタンは `[barActions]`。`defaultFilter` で最初の絞り込み。
- 状態色：`StatusTone` は yours・attention・waiting・done・error と旧 action（要確認の見た目。作り直すときに置き換える）。`needsMe(tone)` は自分が手を動かす状態。
- 確認：`shared/confirm-dialog` の `ConfirmService.ask({ title, message, count, items, notice })`。
- 賞与：`features/bonus/`。1人分は `BonusPersonComponent`（右のパネル、`linkedSignal` で人を切り替えると入力が戻る）。状態色は画面だけ変えた（サーバーの `bonusStepState` の判定は同じ）。
- 入社のまとめ：データでは持たず、`onboarding.types.ts` の `groupOnboarding`（事業所×入社日）。`onboardingList` は `hireDate` で絞れ、1000件ずつ最後まで読む（旧方式の資格取得の手続きが上限を埋めていた。2026-10-30 デプロイ）。古い `?batchId=` のリンクはまとめの画面へ移す。
- ブラウザーペインは背景にあるとアニメーションが止まるため、パネルにアニメーションを付けない。

## 5. 現在の状態（本番）

- 段階4の関数と `homeTodos` はデプロイ済み。段階6の `resignationStart`・`resignationGet`・`resignationPreview`・`resignationUpdate`・`userUnsuspend`（今回が初公開）、扶養の `dependentChangeStart`・`dependentChangeGet`・`dependentChangePreview`・`dependentChangeUpdate`、直した `dependentList` もデプロイ済み。産休・育休の `leaveProcedureStart`・`leaveProcedureGet`・`leaveProcedurePreview`・`leaveProcedureUpdate` と、変更した `leaveList`・`homeTodos`・`filingMockSubmit`・`filingPdfData`・`monthlyJobChunk`・`monthlyInsuranceCalculate`・`bonusInsuranceCalculate` も 2026-10-29 にデプロイ済み（ただし `homeTodos` の期間の表示（「6月30日〜10月10日」の形）の直しは未デプロイ）。旧画面の `operationsMonthlyAction` は免除の変更を反映していない。認証（`middleware/auth.ts`）の変更は、これらの関数にだけ反映されている。**Hosting（画面）は未公開**（ローカルの開発サーバーで確認している）。
- 算定基礎届（2026-10-30）：`santeiRunOverview`・`santeiRunHold`・`santeiDecision`・`santeiJobStart`・`santeiJobGet`・`santeiJobChunk`（asia-northeast1）・`santeiFilingCreate`・`santeiFilingUpdate`・`santeiFilingGet`・`sampleSanteiCreate` を新規デプロイ。`homeTodos` を再デプロイ（算定基礎届のやることと、産休・育休の期間の表示の直しを含む）。
- 料率マスタ：2026-10-29 に修正済み（単位を ‰ に、協会けんぽ令和7・8年度の東京・大阪・兵庫の健保と介護を追加。修正関数 `migrateInsuranceRates`）。全国一律の厚年・拠出金は、甲子園のサンプル用の料率（2026-04〜）で決まっている（値は正しい）。
- テストデータ：
  - 本社・2026年11月支給の3名（テスト 入社太郎・岩貞 祐太・前田 翔太）は6ステップ完了。本社に別途追加された「高橋 三郎（T-11111）」は等級なしで「計算できません」。
  - 「サンプル負荷テスト事業所」（`sample-load-office`、翌月控除、300名、`sampleLoadCreate` で作成）：2026年10月・11月支給は完了。12月支給には LOAD-0001 の未承認の給与が1件だけある。給与項目マスタに「住宅手当」を追加済み。
  - 本番にユーザーが作った入社手続き「前田 翔太」（9月1日入社）が2件ある。旧方式の退職手続き「前田 翔太 退職手続き」も進行中で残っている。
  - 扶養のテスト（2026-10-29）：LOAD-0298 林 修に配偶者 林 花子（年収100万円）と子 林 太郎（2006年生まれ・年収140万円）を 2026-11-01 付けで追加し、完了まで通した（台帳に2人いる）。
  - 退職のテスト（2026-10-29、いずれも退職日 2026-11-30）：LOAD-0299 斎藤 修は完了（模擬電子申請済み。別途入金 45,000円は未記録のまま）。LOAD-0300 清水 修は等級なしのため「最後の保険料の集め方」で止まっている（等級なしの表示の確認用）。どちらも台帳は退職済み。
  - 産休・育休のテスト（2026-10-29〜30）：サンプル負荷テスト事業所に「T-LEAVE1 テスト 産休花子」（女性・2026-04-01入社・月給30万円）を入社の手続きで登録（台帳と雇用条件まで。資格取得届は未作成のため、入社の手続きは「等級を確かめて資格取得届を作る」で止まっている。毎月の処理の10月支給に要対応が1名増えた）。産休（出産予定日 2026-08-10、出産日 2026-08-15 で変更届、2026-10-10 に予定どおり終了）は完了。続けて育休（子 テスト 太郎、2026-10-11〜）を始め、2026-10-29 に早めに終えて終了届を出し、完了した（免除は2026年10月のみ）。
  - 算定基礎届のテスト（2026-10-30）：`sampleSanteiCreate` で「サンプル算定テスト事業所」（`sample-santei-office`、300名、`SANTEI-0001`〜。2026年4〜6月支給の承認済みの給与、前年9月の等級。50人ごとに除外・保留・日数不足・パート・短時間・途中入社・遡及支払・70歳以上の人）を作成。2026年の定時決定：不足の6名を従前で決定、12名を保留、270名の等級を承認（9月の等級が確定）、届出（2件目。1件目は取り消し）を承認→模擬電子申請→完了。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る（給与なし294名）。
- 賞与（2026-10-30）：`bonusRunOverview`・`bonusRunHold`・`bonusRunImport`・`bonusRunEntry`・`bonusRunNonPayment`・`bonusJobStart`・`bonusJobGet`・`bonusJobChunk`（asia-northeast1）・`bonusFilingCreate`・`bonusFilingUpdate`・`bonusFilingGet`・`sampleBonusCreate` を新規デプロイ。`bonusInsuranceCalculate`・`homeTodos`・`officeList`・`officeUpdate` を再デプロイ。
- 随時改定・終了時改定（2026-10-30）：`gradeRevisionStart`・`gradeRevisionGet`・`gradeRevisionPreview`・`gradeRevisionUpdate`・`sampleRevisionCreate` を新規デプロイ。`monthlyRunOverview`・`homeTodos`・`approvalRequestApprove`・`filingMockSubmit`・`filingPdfData`・`filingCreate` を再デプロイ。`homeTodos` の期間の表示の直しも、この再デプロイより前に反映済み（別セッションで確認）。
- 年齢到達（2026-10-30）：`ageEventStart`・`ageEventGet`・`ageEventPreview`・`ageEventUpdate`・`sampleAgeCreate` を新規デプロイ。75歳の直しで `monthlyInsuranceCalculate`・`monthlyJobChunk`・`bonusInsuranceCalculate`・`bonusJobChunk`・`resignationGet`・`resignationPreview`・`resignationUpdate`・`employeeResign` を、ほかに `homeTodos`・`filingMockSubmit`・`filingPdfData`・`filingCreate` を再デプロイ。
- 雇用条件の変更など（2026-10-30）：`employmentChangeStart`・`employmentChangeGet`・`employmentChangePreview`・`employmentChangeUpdate`・`sampleChangeCreate`・`transferStart`・`transferGet`・`transferPreview`・`transferUpdate`・`employeeOtherEmployerSet` を新規デプロイ。`homeTodos`・`employeeGet`・`employmentCreate`・`onboardingUpdate`・`monthlyRunOverview`・`resignationGet`・`gradeRevisionGet`・`ageEventGet` を再デプロイ。
- 東京への移転（2026-10-30）：公開済みの関数178個（呼び出し型169個＋トリガー・定期9個）を asia-northeast1 にデプロイし、us-central1 の173個（移した169個と、コードにない旧 `santeiPreview`・`santeiSubmit`・`gradeRevisionCheck`・`gradeRevisionSubmit`）を削除した。未公開の7個（`ageEventCheck`・`employeeSecretsGet`・`employeeSecretsUpdate`・`procedureCreate`・`salaryCsvImport`・`userDisableLogin`・`userSuspend`）は今もデプロイしていない。
- 端数処理の移行（`migrateOfficeRoundingRule`）は未実行。会社設定の「特定適用事業所」は未登録（3/4未満の人の加入判定が「担当者の判断が必要」になる）。
- 賞与のテスト（2026-10-30）：`sampleBonusCreate` で「サンプル賞与テスト事業所」（`sample-bonus-office`、300名、`BONUS-0001`〜、支給予定月 7・9・12月、2026年4・7・8月の賞与つき。50人ごとに同月2回・上限に近い・上限超え・4回目・育休免除・70歳以上・喪失月・喪失日以後・支給なし・現物・7月未承認・適用外の人）を作成。12月支給を表の貼り付けで294名取り込み（1人分の入力で BONUS-0011 に2回目 100,500円を追加）、賞与額を承認、282名の保険料を計算（7月未承認の6名は失敗→保留）、276名の保険料を承認、届出（276名）を承認→模擬電子申請→完了。9月は不支給のアラートが出たまま（記録の操作は未確認）。7月の未承認6名のため、ホームに「賞与（2026年7月支給）：賞与額の承認を依頼する」が出る。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る（給与なし300名）。
- 改定のテスト（2026-10-30）：`sampleRevisionCreate` で「サンプル改定テスト事業所」（`sample-revision-office`、11名 `REV-0001`〜。2025年9月の定時決定の等級、2026年6〜9月支給の給与。昇給・降給・1等級差・向き違い・日数不足・遡及・上限・下限・短時間・9月未承認・育休明け）を作成。2026年9月支給の保険料を計算（未承認）。REV-0001 の随時改定（健保22→25・厚年19→22、10月から）と REV-0011 の育休終了時改定（健保22→21・厚年19→18、10月から）は承認→模擬電子申請→完了。REV-0003 は「改定しない」で終えた。ホームに「毎月の処理（2026年9月・10月支給）」が増えている。
- 年齢到達のテスト（2026-10-30）：`sampleAgeCreate` で「サンプル年齢到達テスト事業所」（`sample-age-office`、7名 `AGE-0001`〜。40・65歳、70歳（報酬が同じ／再雇用で下がった・12月1日生まれ／10月に到達済み）、75歳（配偶者が被扶養者／11月1日生まれ）。2026年9月の等級と8〜10月支給の承認済みの給与）を作成。AGE-0003（70歳・届出なし）は完了、AGE-0004（70歳・届出あり）と AGE-0006（75歳）は承認→模擬電子申請→完了。AGE-0005（10月到達・期限切れ）と AGE-0007（75歳・11月1日生まれ）はホームのやることに残っている。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る。
- 変更のテスト（2026-10-30）：`sampleChangeCreate` で「サンプル変更テスト事業所」（`sample-change-office`、東京）と「サンプル変更テスト大阪事業所」（`sample-change-office-osaka`）、6名 `CHG-0001`〜 を作成。CHG-0001 は契約を2027-11-30まで更新（完了）、CHG-0002 は11月15日満了の知らせが出たまま、CHG-0003 は12月からパート（資格喪失届を提出・完了）、CHG-0004 は12月から正社員（資格取得届を提出・完了、12月の資格取得時決定の等級）、CHG-0005 は12月1日に大阪へ異動（届出2件を提出・完了、所属は大阪）、CHG-0006 は二以上事業所（株式会社サンプル物流）を登録。CHG-0001 には、最初の保存のエラーの前に作られた余分な雇用条件の承認依頼（effectiveDate のない下書き）が1件ある（ユーザーに差し戻しを依頼）。
- 確認のテスト（2026-10-30）：REV-0011 に産休終了時の改定（⑪、9月から健保21・厚年18）を完了。CHG-0006 に育休（2026-11-01〜2027-08-19、申出書は承認済み・提出前）、サンプル変更テスト事業所の2026年11月分の保険料を計算（未承認、CHG-0006 は免除で0円）。LOAD-0298 の扶養の手続き（子を外す・配偶者の氏名を「はな子」に変更）を紙の受理まで完了。CHG-0002 は退職日（2026-11-15）を登録し、最後の保険料のステップで止まっている（8月の等級がない）。
- テスト：639件中630件成功（2026-10-30）。失敗9件は改修前から（各テスト独自のモックが手続き機能に追随していない。段階10で対応）。

## 6. 次にやるべきタスク

0. **段階7.5（UI統一）の続き**：①共通部品・②賞与と入社は済み（2026-10-30、4-18）。次は③残りの手続き（毎月の処理・算定は賞与と同じ多人数の型、退職・年齢到達は入社と同じまとめ（退職日・到達月で束ねる。退職日が未入力の人は「退職日 未入力」のまとめ）、扶養・休業・雇用条件の変更・異動・随時改定はウィザードのステップ名を短くし主ボタンの文言と注意をそろえる）→ ④ホーム・手続き一覧・承認・届出（`homeTodos` の速さも）。1人の画面の自動下書き保存は未着手（サーバーに下書きの関数が要る。ユーザーと相談）。
1. **段階7の残り（ユーザー判断・小さな直し）**：
   - ZIPの大きさ（約150MB）：PDFごとに日本語フォントを丸ごと埋め込んでいる。フォントを使う文字に絞るか（以前、絞り込みで文字が抜けたため丸ごとにした経緯あり）を決める。
   - 算定基礎届・賞与支払届（run の届出）の訂正届・取消届：1人分を取り出す作り方を決める。
   - 届出の画面から承認を申請しても、届出の `workflowStatus` が draft（差戻しなら rejected）のままで、届出一覧の状態が「承認待ち」にならない（承認一覧には出る）。申請時に pending にするか決める（ウィザードの判定への影響を確かめる）。
   - 古い形式の届出（項目名が英語、例：坂本 誠志郎の資格取得届）は記入内容に被保険者氏名がなく、PDF・模擬電子申請が通らない。テストデータの作り直しか、移し替えを決める。
   - 未確認：算定基礎届・賞与の届出のカードでの提出部品・添付（承認済みで未提出の run の届出がないため）、内容を直したときの差分の強調、承認後の書き換えの警告、毎朝のリマインド、バッジの数字。
   以下は段階7の着手時のメモ：`docs/stage7-plan.md` の順に進める。以下は着手時のメモ：`docs/roadmap.md` の段階7：不足している届出種別（⑥賞与不支給報告書・⑩訂正届・取消届など）、承認取消・送信取消、模擬申請の段階遷移と受付番号、添付、期限計算、一括承認、差分表示、ZIP。終わりの条件は「12種すべてが作成から提出記録まで通る」。まずチェックリストの段階7の行（届出・承認の章）と、届出一覧・承認一覧に出ない届出（算定基礎届・賞与支払届は run の下にある）の扱いを調べ、方針をユーザーに示して合意を取ってから作る。届出の画面の模擬申請・提出記録は `window.confirm` を通るため、ブラウザーペインで押せない点も段階7で見直す（ダイアログを画面内の確認にするなど）。
2. **段階6で後回しにしたもの**（ユーザー判断で段階8・9と合わせる）：
   - 外国人の退職案内：表示の処理はある。外国人情報（ローマ字氏名・在留資格など）を入れる画面がないため未確認。台帳の項目の画面か、段階9の本人入力と合わせる。
   - 退職後の閲覧期間の延長・短縮、ログイン停止（閲覧専用→停止）：アカウントを持ち、等級がそろった従業員と、そのアカウントでのログイン（ユーザー操作）が要る。段階8のログインまわりと合わせる。
3. **段階6の任意の確認**（必要なら）：紙の提出・差し戻しの表示（各ウィザード）、承認者だけのアカウントでのホーム表示、退職の画面で70歳・75歳の人を通す、毎月の処理で75歳の月初生まれの保険料（10月分まで健保）を計算、産休・育休の完了画面から終了時改定を始める流れ、下限の特例で従前の報酬月額を入れる操作、改定した月の保険料の計算し直しの案内、賞与の不支給報告書の記録と取り消し、7月の未承認6名を承認して12月を計算し直す流れ、9月分の保険料に定時決定の等級が使われること、産休の終了届、育休の延長の提出、二以上事業所の警告（退職・随時改定・年齢到達・雇用条件の変更・異動の各画面）、2か月以内の有期契約の適用外（入社の画面）、異動日より前の月の毎月の処理が異動先に出てしまう点。
4. **速さ**（2026-10-30 に東京へ移転・読み込みの遅延を済ませた）：関数を画面を通さずに呼んだ時間（移転前→後、2回目以降）は、承認一覧 `approvalSearch` 1.2〜1.5秒→0.13〜0.17秒、ウィザード `onboardingGet` 1.9〜2.1秒→0.2秒（起動直後は9.0秒→1.2秒）、賞与 `bonusRunOverview` 8.4秒→3.1〜3.4秒。起動（ログの「Starting new instance」から起動確認まで、デプロイ直後の起動の比較）は中央値4.0秒→1.6秒。**残る課題：ホーム `homeTodos` が東京でも17〜20秒**（移転前24〜35秒）。開くたびに事業所ごと・月ごとに毎月の処理・算定基礎届・賞与の状況（`monthlyOverview` など）をまるごと計算し直しているため。件数だけを索引や run の集計から読む形に直す。UI統一（段階7.5）でホームを作り直すときに一緒に行う（2026-10-30 ユーザー決定）。
5. 以前からの残り：認証の変更を全関数に反映する再デプロイ（承認要）、端数処理の移行の実行（承認要）、入社の差し戻し・返戻の画面確認、特定適用事業所の登録（ユーザーに確認。未登録のため3/4未満の人の加入判定が「担当者の判断」になる）、Hosting の公開（承認要。公開中の web.app は古く、米国の関数を呼ぶため、2026-10-30 の米国の関数の削除以降は動かない。公開すれば東京を呼ぶ）。
6. **段階7のあと・段階8の前にUI統一（段階7.5）**（2026-10-30 ユーザー決定）：設計は決定済み：`docs/ui-unification-design.md`（見本は `ui-proposals/`）。段階7の残りはそのまま進めてよいが、7-3以降で新しく作る承認・届出の画面と確認の表示は、この設計に寄せる（`window.confirm` は画面内の確認ダイアログにする）。
7. 以降は `docs/roadmap.md` の段階8〜10。後続課題は `docs/catalog-checklist.md` の末尾。

### 段階7.5 の着手メモ

- **設計**：`docs/ui-unification-design.md`（決定済み。骨組み＝見出し→横並びのステップ→本体→下に固定の操作バー、説明は1行＋必要なときだけ注意、主ボタンは1つ、入社・退職・年齢到達は日ごとのまとめ＋1人の画面、内訳は右のパネル、確認は画面内ダイアログ、自動下書き保存、状態5種）。見本と比較は `ui-proposals/`（`index.html`・`bonus.html`・`onboarding-person.html`・`approvals.html`・`decide-*.html`）。roadmap の段階7.5の行も設計どおりに書き換え済み。
- **注意：設計・見本・roadmap の書き換えはまだコミットされていない**（別セッションが作った `docs/ui-unification-design.md`・`ui-proposals/`・`docs/roadmap.md` の変更。2026-10-30 時点で作業ツリーにある）。着手したらまずユーザーに確認してコミットする。
- **進め方**（設計の6章）：①共通部品の中身を変える（`shared/ui/wizard.ts`・`target-list.ts`・`status-badge.ts`（4種→5種）・`shared/confirm-dialog/confirm-dialog.ts` を土台に確認ダイアログ）→ ②賞与（`features/bonus/`）で多人数の型、入社（`features/onboarding/`）で「まとめ＋1人」の型を作り直して画面で確かめる → ③残りの手続き（毎月の処理 `monthly`・算定 `santei`・随時改定 `revision`・退職 `resignation`・年齢到達 `age-event`・扶養 `dependent-change`・休業 `leave`・雇用条件の変更 `employment-change`・異動 `transfer`）→ ④ホーム（`dashboard`）・手続き一覧（`procedures`）・承認（`approvals`）・届出（`filings`）。入社・退職・年齢到達の「まとめ」をデータで持つか表示時に日付で束ねるかは、着手時に調べて決める。
- **段階7で作った部品も設計に寄せる**：提出の部品 `features/filings/submission/filing-submission.ts` は確認を画面内のパネルで出している（→確認ダイアログに）。添付 `features/filings/attachments/filing-attachments.ts`、承認一覧 `features/approvals/approval-list/approval-list.ts`（設計は左右に分けた受信箱の形）、届出一覧・届出の画面。状態の色は `features/filings/filing-labels.ts` の `filingTone` も5種に合わせる。
- **`window.confirm` が残っている所**：`core/services/office-context.service.ts`（事業所の切り替え。ブラウザーペインでは押せないので、画面の確認では URL の `?officeId=` で切り替えている）、`features/monthly/monthly.ts`（明細の公開）、`features/procedures/procedure-detail.ts`（手続きの取消）。
- **ホームの速さ**：`homeTodos` が東京でも17〜20秒。ホームを作り直すときに、件数を集計しておいて読む形にする（4. 速さ、を参照）。
- **最近直したこと**：上部の事業所のプルダウンが、選んでいる事業所を表示せず「全事業所」のままだった（選択肢を事業所の読み込み後に作るため）。選択肢の側で選択を示すよう直した（2026-10-30、コミット eb933ce、画面だけ）。承認の一覧で、事業所を選んでいるときにほかの事業所の承認待ちの件数を出し「すべての事業所を表示」できるようにした。
- **開発サーバー**：`.claude/launch.json` の `angular-dev`（空いているポートで起動。2026-10-30 の最後は 4204）。ポートが変わるとログインし直し（ユーザーに頼む）。承認の確認は別アカウント（承認者 金本 知憲。ユーザーが操作）。

### 次のセッションの作業メモ

- 開発サーバーは `.claude/launch.json` の `angular-dev`。空いているポートで起動し、ポートが変わるとログインし直し（ユーザーに頼む）。
- 本番の関数を画面を通さずに呼ぶとき：ブラウザーペインで IndexedDB の `firebaseLocalStorageDb` からトークンを取り、`https://asia-northeast1-kensyu10171.cloudfunctions.net/<関数名>` に `{ data: {...} }` を POST する（companyId は `company-001`）。画面を移るとページの変数は消える。
- 画面確認のコツ：日本語・日付は `form_input`、数値は三回クリックしてから `type`、`mat-select` はクリックして選択肢を `find`。表示幅はターンごとに戻るので `resize_window` を毎回指定する。PDFのプレビューは iframe を `position:fixed` にして `#page=1&zoom=110,0,500` を付けて読み込み直す。
- 承認は別アカウントが要る（ユーザーに頼む）。本番への書き込み・デプロイ・テストデータの作成は事前にユーザーに確認する。

### 段階6の着手メモ

- **順番**（ロードマップ）：退職（済み）→ 扶養（済み） → 産休・育休（済み） → 算定基礎届（済み） → 賞与（済み） → 随時改定・終了時改定（済み） → 年齢到達（済み）。業務ごとに「データ→計算→画面→一括操作→実ブラウザー確認」を終え、チェックリストを埋めてから次へ進む。
- **型**：退職・扶養・産休育休・随時改定・年齢到達は個人型（入社のウィザード `features/onboarding/onboarding-wizard.ts` ＋ `functions/src/onboarding/` が見本）。算定基礎届・賞与は一括型（毎月の処理 `features/monthly/` ＋ `functions/src/monthly/` が見本。賞与は `features/bonus/` ＋ `functions/src/bonus/`）。
- **入口**：ライフイベントのカード `features/procedures/life-events.ts`。休業・異動は今 `procedure-start.ts` で従業員を選び、従業員詳細 `/employees/:id?action=<種類>` へ移る。退職・扶養は `start()` の `wizard` の表でウィザードへ移る（見本にする）。随時改定は `/employees/:id/revision`。ウィザードができたら、`procedure-start.ts` の `start()` で行き先を変える。
- **退職の作り（見本）**：上の「4-3」を参照。画面は `features/resignation/`（入社のウィザードのスタイルを共用）。旧方式の `employeeResign`／`createLossProcedure`／`LOSS_STEPS` は画面から使っていない。
- **ホーム**：ウィザードを作った業務は `home/service.ts` の `wizardTodo` を使い、`procedureTodos` の振り分けに1行足す（退職・扶養と同じ）。`home/rules.ts` と画面の `dashboard.ts` の `kind` にも種類を足す。

## 7. 作業上の注意

- **本番への書き込み・デプロイ・Hosting の公開は事前にユーザーに確認する。** 本番の認証にパスワードを入力しない。承認の確認には別アカウントが要る（ユーザーが操作）。
- **デプロイ**は PowerShell から関数名を明示して行う（Bash からは firebase CLI が動かない）：
  `firebase deploy --only functions:default:<名前>,functions:default:<名前> --project kensyu10171 --non-interactive`
  全体デプロイはしない（未公開の関数が7個あり、個人番号が平文のものを含む）。コマンドは2000文字を超えると端末に渡せないので、60個ほどずつに分ける。関数のリージョンを変えるとき、CLI は旧リージョンの同名の関数を削除するか聞く（`--non-interactive` では止まる）。先に新しいリージョンを作るなら、ターミナルのタブで `--interactive` を付けて実行し、ユーザーに N と答えてもらい、確認後に `firebase functions:delete <名前…> --region <旧> --project kensyu10171 --force` で消す。別 codebase `socialinsurance` に触れない。
- **Firestore の索引**：`firestore.indexes.json` は本番より古い。索引のデプロイは本番の定義と合わせ、明示の承認を得る。新しい処理は複合索引に頼らない形にしている。
- Firestore のトランザクションでは書き込みの前にすべて読み取る。監査ログなどに `undefined` を書かない（書き込みが失敗する）。
- ビルドとテスト：`functions` で `npx tsc --noEmit -p .` と `npx jest --config jest.config.js`、`src` で `npx ng build --configuration development`（以前からの警告 NG8011 が出る）。
- 開発サーバー：`.claude/launch.json` の `angular-dev`（本番の Firebase に接続。ポートが埋まっていると 4203 などになり、ログインし直しが必要）。
- 画面確認の注意：ブラウザーペインの日本語の自動入力は Angular に伝わらないことがある（`form_input` を使う）。`window.confirm` はペインで押せない。共通部品を変えると開発サーバーが画面を読み込み直し、画面内の状態が消える。数値の入力欄（`ngModel` の type=number）は `form_input` が伝わらないので、クリックして `type` で打つ。表示幅の設定はターンごとに戻る。PDFのプレビュー（iframe の中）はクリックできないため、記入位置を見るときは JS で iframe を `position: fixed` にし、`src` に `#page=1&zoom=200,左,上` を付けて読み込み直す。
- 一部のファイルは改行が CRLF になっている。スクリプトで置換するより Edit ツールを使う。

## 8. 関連文書

| 文書 | 内容 |
|---|---|
| `docs/roadmap.md` | 段階0〜10の手順と終わりの条件（正） |
| `docs/catalog-checklist.md` | カタログ各項目の状態と担当段階、後続課題 |
| `docs/catalog-gap-analysis.md` | 初回の乖離分析（段階1以前） |
| `docs/ux-one-way-plan.md` | 一本道UI・大人数対応の方針 |
| `docs/screen-restructure-*.md`、`work/*.md` | 旧計画・旧引継ぎ（参考のみ） |
