// ============================================================
//  SAVVY REALTY — VA Assessment Google Apps Script  (v3)
//  FIXED: CORS headers added so any browser can submit results
//
//  Deploy settings:
//    Execute as:     Me
//    Who has access: Anyone
// ============================================================

const SHEET_NAME_SUBMISSIONS = "Submissions";
const SHEET_NAME_ANSWERS     = "Answer Detail";
const SHEET_NAME_WRITTEN     = "Written Responses";

// ── ALL requests go through doGet with an "action" param ────
//  We use GET-only (via query string) to avoid CORS preflight
//  issues that block POST requests from local file:// origins.
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || "";

    if (action === "submit")     return respond(handleSubmit(JSON.parse(params.data)));
    if (action === "saveGrades") return respond(handleSaveGrades(JSON.parse(params.data)));
    if (action === "getAll")     return respond(handleGetAll());

    // Health check — visiting the URL with no params
    return respond({ ok: true, message: "Savvy VA Assessment Script is running correctly." });

  } catch(err) {
    return respond({ ok: false, error: err.message });
  }
}

// ── Also keep doPost as fallback ────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === "submit")     return respond(handleSubmit(data));
    if (data.action === "saveGrades") return respond(handleSaveGrades(data));
    return respond({ ok: false, error: "Unknown action" });
  } catch(err) {
    return respond({ ok: false, error: err.message });
  }
}

// ── Respond with JSON + CORS headers ────────────────────────
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SUBMIT a new assessment result ──────────────────────────
function handleSubmit(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Submissions sheet — one row per attempt
  let subSheet = ss.getSheetByName(SHEET_NAME_SUBMISSIONS);
  if (!subSheet) {
    subSheet = ss.insertSheet(SHEET_NAME_SUBMISSIONS);
    subSheet.appendRow([
      "Submission ID","Name","Date/Time",
      "Auto Score","Auto Total","Auto %",
      "Written Pts","Written Max",
      "Final %","Final Grade","Status"
    ]);
    subSheet.getRange(1,1,1,11).setFontWeight("bold").setBackground("#0F1114").setFontColor("#FFFFFF");
    subSheet.setFrozenRows(1);
  }

  const writtenMax = 50;
  const autoTotal  = data.autoTotal || 0;
  const autoScore  = data.autoScore || 0;
  const autoPct    = autoTotal > 0 ? Math.round(autoScore / autoTotal * 100) : 0;

  subSheet.appendRow([
    data.id, data.name, data.dateDisplay,
    autoScore, autoTotal, autoPct + "%",
    "", writtenMax, "", "", "Needs Grading"
  ]);

  // 2. Answer Detail sheet — one row per auto-graded question
  let ansSheet = ss.getSheetByName(SHEET_NAME_ANSWERS);
  if (!ansSheet) {
    ansSheet = ss.insertSheet(SHEET_NAME_ANSWERS);
    ansSheet.appendRow([
      "Submission ID","Name","Date","Q#","Type",
      "Question (short)","User Answer","Correct Answer","Result"
    ]);
    ansSheet.getRange(1,1,1,9).setFontWeight("bold").setBackground("#2896C8").setFontColor("#FFFFFF");
    ansSheet.setFrozenRows(1);
  }

  const answers = data.answers || {};
  Object.entries(answers).forEach(([qId, ans]) => {
    if (ans.type === "written") return;
    ansSheet.appendRow([
      data.id, data.name, data.dateDisplay, qId, ans.type,
      ans.question ? ans.question.substring(0, 80) : "",
      formatAnswer(ans),
      ans.correctAnswer !== undefined ? String(ans.correctAnswer) : "",
      ans.correct === true ? "Correct" : ans.correct === false ? "Incorrect" : "Not answered"
    ]);
  });

  // 3. Written Responses sheet — one row per written question
  let wrSheet = ss.getSheetByName(SHEET_NAME_WRITTEN);
  if (!wrSheet) {
    wrSheet = ss.insertSheet(SHEET_NAME_WRITTEN);
    wrSheet.appendRow([
      "Submission ID","Name","Date","Question ID",
      "Question (short)","Response","Grade","Grade Notes","Points"
    ]);
    wrSheet.getRange(1,1,1,9).setFontWeight("bold").setBackground("#0F1114").setFontColor("#4ABDE8");
    wrSheet.setFrozenRows(1);
  }

  Object.entries(answers).forEach(([qId, ans]) => {
    if (ans.type !== "written") return;
    wrSheet.appendRow([
      data.id, data.name, data.dateDisplay, qId,
      ans.question ? ans.question.substring(0, 80) : "",
      ans.userAnswer || "", "", "", ""
    ]);
  });

  try { subSheet.autoResizeColumns(1, 11); } catch(e) {}
  try { ansSheet.autoResizeColumns(1, 9);  } catch(e) {}
  try { wrSheet.autoResizeColumns(1, 9);   } catch(e) {}

  return { ok: true, message: "Submission saved." };
}

// ── SAVE GRADES ──────────────────────────────────────────────
function handleSaveGrades(data) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const subSheet = ss.getSheetByName(SHEET_NAME_SUBMISSIONS);
  const wrSheet  = ss.getSheetByName(SHEET_NAME_WRITTEN);
  const subId    = data.id;
  const grades   = data.grades || {};
  const notes    = data.notes  || {};
  const writtenMax = 50;

  let writtenPts = 0;
  Object.values(grades).forEach(g => {
    if (g === "pass")    writtenPts += 10;
    if (g === "partial") writtenPts += 5;
  });

  if (wrSheet) {
    const wrData = wrSheet.getDataRange().getValues();
    for (let i = 1; i < wrData.length; i++) {
      if (String(wrData[i][0]) === String(subId)) {
        const qId        = String(wrData[i][3]);
        const grade      = grades[qId] || "";
        const note       = notes[qId]  || "";
        const pts        = grade === "pass" ? 10 : grade === "partial" ? 5 : 0;
        const gradeLabel = grade === "pass" ? "Pass" : grade === "partial" ? "Partial" : grade === "fail" ? "Fail" : "";
        wrSheet.getRange(i+1, 7).setValue(gradeLabel);
        wrSheet.getRange(i+1, 8).setValue(note);
        wrSheet.getRange(i+1, 9).setValue(pts);
      }
    }
  }

  if (subSheet) {
    const subData = subSheet.getDataRange().getValues();
    for (let i = 1; i < subData.length; i++) {
      if (String(subData[i][0]) === String(subId)) {
        const autoScore = Number(subData[i][3]) || 0;
        const autoTotal = Number(subData[i][4]) || 0;
        const totalPts  = autoScore + writtenPts;
        const maxPts    = autoTotal + writtenMax;
        const finalPct  = maxPts > 0 ? Math.round(totalPts / maxPts * 100) : 0;
        const grade     = finalPct >= 90 ? "Excellent" : finalPct >= 80 ? "Proficient" : finalPct >= 65 ? "Developing" : "Needs Review";
        subSheet.getRange(i+1, 7).setValue(writtenPts);
        subSheet.getRange(i+1, 9).setValue(finalPct + "%");
        subSheet.getRange(i+1, 10).setValue(grade);
        subSheet.getRange(i+1, 11).setValue("Graded");
        break;
      }
    }
  }

  return { ok: true, message: "Grades saved." };
}

// ── GET ALL submissions ──────────────────────────────────────
function handleGetAll() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const subSheet = ss.getSheetByName(SHEET_NAME_SUBMISSIONS);
  const wrSheet  = ss.getSheetByName(SHEET_NAME_WRITTEN);
  const ansSheet = ss.getSheetByName(SHEET_NAME_ANSWERS);

  if (!subSheet) return { ok: true, submissions: [] };

  const subRows = subSheet.getDataRange().getValues();
  const wrRows  = wrSheet  ? wrSheet.getDataRange().getValues()  : [];
  const ansRows = ansSheet ? ansSheet.getDataRange().getValues() : [];

  const submissions = [];
  for (let i = 1; i < subRows.length; i++) {
    const row = subRows[i];
    if (!row[0]) continue;
    const id = String(row[0]);

    const writtenAnswers = {};
    for (let j = 1; j < wrRows.length; j++) {
      if (String(wrRows[j][0]) === id) {
        const qId = String(wrRows[j][3]);
        writtenAnswers[qId] = {
          question:   String(wrRows[j][4] || ""),
          userAnswer: String(wrRows[j][5] || ""),
          grade:      String(wrRows[j][6] || ""),
          gradeNote:  String(wrRows[j][7] || ""),
          points:     wrRows[j][8] || ""
        };
      }
    }

    const autoAnswers = {};
    for (let j = 1; j < ansRows.length; j++) {
      if (String(ansRows[j][0]) === id) {
        const qId = String(ansRows[j][3]);
        autoAnswers[qId] = {
          question:      String(ansRows[j][5] || ""),
          userAnswer:    String(ansRows[j][6] || ""),
          correctAnswer: String(ansRows[j][7] || ""),
          result:        String(ansRows[j][8] || "")
        };
      }
    }

    submissions.push({
      id:          id,
      name:        String(row[1]  || ""),
      dateDisplay: String(row[2]  || ""),
      autoScore:   row[3] || 0,
      autoTotal:   row[4] || 0,
      autoPct:     String(row[5]  || ""),
      writtenPts:  row[6] || "",
      writtenMax:  row[7] || 50,
      finalPct:    String(row[8]  || ""),
      finalGrade:  String(row[9]  || ""),
      status:      String(row[10] || ""),
      writtenAnswers,
      autoAnswers
    });
  }

  submissions.reverse();
  return { ok: true, submissions };
}

// ── Format answer for display ────────────────────────────────
function formatAnswer(ans) {
  if (ans.type === "tf") {
    return ans.userAnswer === true ? "True" : ans.userAnswer === false ? "False" : "—";
  }
  if (ans.type === "mc" && ans.options && ans.userAnswer !== undefined) {
    return ans.options[ans.userAnswer] || String(ans.userAnswer);
  }
  return String(ans.userAnswer !== undefined ? ans.userAnswer : "—");
}
