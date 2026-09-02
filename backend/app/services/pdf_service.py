"""Generates a downloadable Evidence Packet PDF for a case using reportlab."""
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, ListFlowable, ListItem)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle


def render_evidence_pdf(packet: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitlePS", parent=styles["Title"], textColor=colors.HexColor("#0F172A"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=colors.HexColor("#0F172A"), spaceBefore=10)
    body = styles["BodyText"]

    story = [
        Paragraph("PAYSAFE — Payment Exception Evidence Packet", title_style),
        Paragraph(f"Case ID: {packet['case_id']}  |  Transaction ID: {packet['transaction_id']}", body),
        Spacer(1, 8),
    ]

    summary_rows = [
        ["Payment Rail", packet["payment_rail"]],
        ["Amount", f"₹{packet['amount']:,.2f}" if packet["amount"] is not None else "-"],
        ["Failure Type", packet["failure_type"]],
        ["Case Status", packet["case_status"]],
        ["Debit Status", packet["debit_status"] or "-"],
        ["Credit Status", packet["credit_status"] or "-"],
        ["Network Status", packet["network_status"] or "-"],
        ["SLA Deadline", packet["sla_deadline"] or "-"],
        ["SLA Status", packet["sla_status"] or "-"],
        ["Agent Confidence", f"{packet['agent_confidence']:.2f}" if packet["agent_confidence"] is not None else "-"],
        ["Escalated", "YES" if packet["escalated"] else "NO"],
    ]
    t = Table(summary_rows, colWidths=[150, 320])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F1F5F9")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)

    story.append(Paragraph("Customer Complaint", h2))
    story.append(Paragraph(packet["customer_complaint"] or "(none provided — auto-detected by agent)", body))

    story.append(Paragraph("Decision Reason", h2))
    story.append(Paragraph(packet["decision_reason"] or "-", body))
    story.append(Paragraph(f"Recommended Recovery Action: {packet['recommended_recovery_action'] or '-'}", body))
    if packet["escalated"]:
        story.append(Paragraph(f"Escalation Reason: {packet['escalation_reason']}", body))

    story.append(Paragraph("Investigation Timeline", h2))
    items = []
    for ev in packet["investigation_timeline"]:
        items.append(ListItem(Paragraph(f"<b>{ev['type']}</b> @ {ev['at']}: {str(ev['content'])[:400]}", body)))
    if items:
        story.append(ListFlowable(items, bulletType="bullet"))
    else:
        story.append(Paragraph("No investigation events recorded yet.", body))

    story.append(Paragraph("Audit History", h2))
    aitems = []
    for a in packet["audit_history"]:
        aitems.append(ListItem(Paragraph(f"[{a['timestamp']}] {a['actor']} — {a['action']}: {a['details'][:300]}", body)))
    if aitems:
        story.append(ListFlowable(aitems, bulletType="bullet"))
    else:
        story.append(Paragraph("No audit entries recorded yet.", body))

    doc.build(story)
    return buf.getvalue()
