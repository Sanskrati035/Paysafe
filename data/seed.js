const { randomUUID } = require('crypto');

const CUSTOMERS = [
  'Ananya Rao', 'Rohit Sharma', 'Priya Menon', 'Vikram Singh', 'Fatima Sheikh',
  'Arjun Nair', 'Sneha Kulkarni', 'Karan Malhotra', 'Divya Iyer', 'Aditya Verma',
  'Neha Kapoor', 'Sameer Khan'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randAmount() { return Math.floor((Math.random() * 48000 + 500) / 10) * 10; }

function buildCases(slaRules, count = 14) {
  const now = Date.now();
  const cases = [];

  for (let i = 0; i < count; i++) {
    const rule = pick(slaRules.rules);
    const createdMinutesAgo = Math.floor(Math.random() * 500); // spread across time
    const createdAt = now - createdMinutesAgo * 60 * 1000;
    const slaDeadline = createdAt + rule.slaHours * 60 * 60 * 1000;

    const confidence = Math.floor(Math.random() * 40) + 60; // 60-99
    const severity = confidence > 90 ? 'Low' : confidence > 78 ? 'Medium' : confidence > 68 ? 'High' : 'Critical';
    const evidenceStatus = pick(['Complete', 'Complete', 'Partial', 'Missing']);
    const amount = randAmount();

    const investigationResults = [
      'Debit confirmed at source; beneficiary credit unconfirmed after timeout window.',
      'Duplicate debit detected for identical UPI reference within 90 seconds.',
      'Beneficiary bank returned decline code; auto-reversal not yet observed in ledger.',
      'Settlement batch delay confirmed; funds in transit beyond expected window.',
      'Merchant order marked incomplete; customer debit confirmed, merchant credit not found.',
      'Card authorization shows decline; residual hold still active on customer statement.'
    ];

    const recommendedActions = [
      'Initiate reversal to source account',
      'Escalate to beneficiary bank for manual credit confirmation',
      'Trigger auto-reversal retry via rail switch',
      'Raise chargeback with card network',
      'Hold for manual review - conflicting signals',
      'Initiate reversal to source account'
    ];

    const c = {
      id: 'CASE-' + String(1000 + i),
      transactionId: 'TXN' + randomUUID().split('-')[0].toUpperCase(),
      customer: pick(CUSTOMERS),
      rail: rule.rail,
      amount,
      failureType: rule.failureType,
      slaRuleId: rule.id,
      severity,
      agentConfidence: confidence,
      investigationResult: pick(investigationResults),
      recommendedAction: pick(recommendedActions),
      evidenceStatus,
      status: 'Pending', // Pending | Approved | Rejected | Escalated | Resolved
      createdAt,
      slaDeadline,
      escalated: false,
      workflowStage: 'Human Approval', // for AI agent live view, terminal demo stage for seeded data
      workflowLog: [
        { stage: 'Detecting', note: `${rule.rail} transaction identified.`, timestamp: createdAt + 2000 },
        { stage: 'Classifying', note: `Exception classified as "${rule.failureType}".`, timestamp: createdAt + 5000 },
        { stage: 'Investigating', note: 'Debit/credit ledger cross-check completed.', timestamp: createdAt + 15000 },
        { stage: 'Evaluating Recovery', note: 'Recovery path evaluated against similar historical cases.', timestamp: createdAt + 25000 },
        { stage: 'Checking SLA', note: `SLA rule ${rule.id} applied (${rule.slaHours}h window).`, timestamp: createdAt + 30000 },
        { stage: 'Generating Evidence', note: `Evidence bundle marked ${evidenceStatus}.`, timestamp: createdAt + 40000 },
        { stage: 'Human Approval', note: 'Awaiting operations approval.', timestamp: createdAt + 45000 }
      ]
    };
    cases.push(c);
  }
  return cases;
}

module.exports = { buildCases, CUSTOMERS };
