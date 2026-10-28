"""
Download a bank account's transactions as an Excel statement, laid out like
the "Account Activity" sheet banks such as Nabil Bank hand out.
"""
import re
from io import BytesIO

import frappe
from frappe import _
from frappe.query_builder.functions import Sum
from frappe.utils import add_days, flt, get_fullname, getdate, now_datetime
from erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool import get_account_balance
from nepal_compliance.nepali_date_utils.nepali_date import format_bs
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

COLUMNS = (
	# (header, width)
	("Date (AD)", 13),
	("Date (BS)", 13),
	("Day", 12),
	("Description", 60),
	("Debit Amount", 17),
	("Credit Amount", 17),
)

AMOUNT_FORMAT = "#,##0.00;-#,##0.00"
HEADER_FILL = PatternFill("solid", start_color="C5DCF5")
THIN = Side(style="thin", color="000000")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


@frappe.whitelist(methods=["GET"])
def download_bank_statement(bank_account: str, from_date: str, to_date: str):
	"""Send the statement for a bank account and date range as an .xlsx download."""
	data = get_statement_data(bank_account, from_date, to_date)

	frappe.response["filename"] = _statement_filename(data)
	frappe.response["filecontent"] = build_statement_workbook(data)
	frappe.response["type"] = "binary"


def get_statement_data(bank_account: str, from_date: str, to_date: str) -> frappe._dict:
	"""
	Collect everything the statement shows.

	The opening balance is the bank's balance at the end of the day before
	`from_date` (see `get_opening_balance`). The closing balance is the opening
	balance plus credits (deposits) minus debits (withdrawals) over the period.
	"""
	frappe.has_permission("Bank Account", "read", bank_account, throw=True)

	from_date, to_date = getdate(from_date), getdate(to_date)
	if from_date > to_date:
		frappe.throw(_("From Date cannot be after To Date"))

	account = frappe.db.get_value(
		"Bank Account",
		bank_account,
		["name", "bank", "account", "account_name", "bank_account_no", "company"],
		as_dict=True,
	)

	opening_balance = get_opening_balance(account, from_date)

	transactions = frappe.get_list(
		"Bank Transaction",
		filters=[
			["bank_account", "=", bank_account],
			["docstatus", "=", 1],
			["date", ">=", from_date],
			["date", "<=", to_date],
		],
		fields=["name", "date", "description", "reference_number", "deposit", "withdrawal"],
		order_by="date asc, name asc",
		limit_page_length=0,
	)

	rows = []
	for t in transactions:
		rows.append(
			frappe._dict(
				date=getdate(t.date),
				bs_date=format_bs(t.date, "YYYY-MM-DD"),
				weekday=WEEKDAYS[getdate(t.date).weekday()],
				description=t.description or t.reference_number or "",
				debit=flt(t.withdrawal, 2),
				credit=flt(t.deposit, 2),
			)
		)

	total_debit = flt(sum(r.debit for r in rows), 2)
	total_credit = flt(sum(r.credit for r in rows), 2)
	downloaded_on = now_datetime()

	return frappe._dict(
		bank_account=account.name,
		bank=account.bank or "",
		account_label=_account_label(account),
		from_date=from_date,
		to_date=to_date,
		downloaded_by=get_fullname(frappe.session.user),
		downloaded_on=downloaded_on,
		rows=rows,
		opening_balance=opening_balance,
		total_debit=total_debit,
		total_credit=total_credit,
		closing_balance=flt(opening_balance + total_credit - total_debit, 2),
	)


def get_opening_balance(account: frappe._dict, from_date) -> float:
	"""
	Bank balance at the end of the day before `from_date`.

	Starts from the latest closing balance as per statement saved before `from_date`
	(Mint Bank Statement Balance) and adds the bank transactions dated after it.
	Without a saved statement balance, falls back to the "Opening Balance" the Bank
	Reconciliation screen shows: ERPNext's expected bank balance from the ledger.
	"""
	anchor = frappe.get_all(
		"Mint Bank Statement Balance",
		filters={"bank_account": account.name, "date": ["<", from_date]},
		fields=["date", "balance"],
		order_by="date desc",
		limit=1,
	)

	if anchor:
		bt = frappe.qb.DocType("Bank Transaction")
		net = (
			frappe.qb.from_(bt)
			.select(Sum(bt.deposit) - Sum(bt.withdrawal))
			.where(bt.bank_account == account.name)
			.where(bt.docstatus == 1)
			.where(bt.date > anchor[0].date)
			.where(bt.date < from_date)
		).run()[0][0]
		return flt(flt(anchor[0].balance) + flt(net), 2)

	if account.account:
		return flt(get_account_balance(account.name, add_days(from_date, -1), account.company), 2)
	return 0.0


def build_statement_workbook(data: frappe._dict) -> bytes:
	"""Render the statement data into an .xlsx file and return its bytes."""
	wb = Workbook()
	ws = wb.active
	ws.title = "Account Activity"
	last_col = len(COLUMNS)

	for idx, (_header, width) in enumerate(COLUMNS, start=1):
		ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width

	# Title and details block
	ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
	ws.cell(row=1, column=1, value=_("Bank Statement")).font = Font(bold=True, size=14)
	ws.cell(row=1, column=1).alignment = Alignment(horizontal="center")

	details = (
		(_("Bank Name"), data.bank),
		(_("Bank Account"), data.account_label),
		(_("From Date"), _dual_date(data.from_date)),
		(_("To Date"), _dual_date(data.to_date)),
		(_("Downloaded By"), data.downloaded_by),
		(
			_("Downloaded On"),
			"{0} (BS {1})".format(
				data.downloaded_on.strftime("%Y-%m-%d %H:%M:%S"),
				format_bs(data.downloaded_on, "YYYY-MM-DD"),
			),
		),
	)
	row = 3
	for label, value in details:
		ws.cell(row=row, column=1, value=label).font = Font(bold=True)
		ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=last_col)
		ws.cell(row=row, column=2, value=": {0}".format(value))
		row += 1

	row += 1
	ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_col)
	ws.cell(row=row, column=1, value=_("Account Activity")).font = Font(size=12, underline="single")
	ws.cell(row=row, column=1).alignment = Alignment(horizontal="center")

	# Table header
	row += 1
	header_row = row
	for idx, (header, _width) in enumerate(COLUMNS, start=1):
		cell = ws.cell(row=row, column=idx, value=_(header))
		cell.font = Font(bold=True)
		cell.fill = HEADER_FILL
		cell.border = BORDER
		cell.alignment = Alignment(horizontal="center", vertical="center")

	row += 1
	_balance_row(ws, row, _("Opening Balance"), data.opening_balance)

	for r in data.rows:
		row += 1
		values = (r.date, r.bs_date, r.weekday, r.description, r.debit or None, r.credit or None)
		for idx, value in enumerate(values, start=1):
			cell = ws.cell(row=row, column=idx, value=value)
			cell.border = BORDER
			cell.alignment = Alignment(vertical="top", wrap_text=idx == 4, horizontal="center" if idx <= 3 else None)
		ws.cell(row=row, column=1).number_format = "yyyy-mm-dd"
		ws.cell(row=row, column=5).number_format = AMOUNT_FORMAT
		ws.cell(row=row, column=6).number_format = AMOUNT_FORMAT

	row += 1
	for idx in range(1, last_col + 1):
		cell = ws.cell(row=row, column=idx)
		cell.border = BORDER
		cell.font = Font(bold=True)
	ws.cell(row=row, column=4, value=_("Total")).alignment = Alignment(horizontal="center")
	for idx, value in ((5, data.total_debit), (6, data.total_credit)):
		ws.cell(row=row, column=idx, value=value).number_format = AMOUNT_FORMAT

	row += 1
	_balance_row(ws, row, _("Closing Balance"), data.closing_balance)

	ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
	ws.print_title_rows = f"{header_row}:{header_row}"
	ws.page_setup.fitToWidth = 1
	ws.page_setup.fitToHeight = 0
	ws.sheet_properties.pageSetUpPr.fitToPage = True

	out = BytesIO()
	wb.save(out)
	return out.getvalue()


def _balance_row(ws, row: int, label: str, amount: float):
	"""Opening/closing balance row: label under Description, amount across Debit and Credit."""
	for idx in range(1, len(COLUMNS) + 1):
		ws.cell(row=row, column=idx).border = BORDER
	ws.cell(row=row, column=4, value=label).alignment = Alignment(horizontal="center")
	ws.merge_cells(start_row=row, start_column=5, end_row=row, end_column=6)
	cell = ws.cell(row=row, column=5, value=amount)
	cell.number_format = AMOUNT_FORMAT
	cell.font = Font(bold=True)
	cell.alignment = Alignment(horizontal="right")


def _dual_date(date) -> str:
	return "{0} (BS {1})".format(date.isoformat(), format_bs(date, "YYYY-MM-DD"))


def _account_label(account: frappe._dict) -> str:
	if account.account_name and account.bank_account_no:
		return f"{account.account_name} - {account.bank_account_no}"
	return account.bank_account_no or account.account_name or account.name


def _statement_filename(data: frappe._dict) -> str:
	name = re.sub(r"[^\w\- ()]+", "", data.bank_account).strip() or "Bank Account"
	return f"{name} Statement {data.from_date} to {data.to_date}.xlsx"
