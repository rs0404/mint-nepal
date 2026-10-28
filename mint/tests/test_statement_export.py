import unittest
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate
from nepal_compliance.nepali_date_utils.nepali_date import format_bs
from openpyxl import load_workbook

from mint.apis.statement_export import build_statement_workbook, get_statement_data

BANK = "_Test Mint Statement Bank"


class TestStatementExport(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		gl_account = frappe.db.get_value(
			"Account", {"account_type": "Bank", "is_group": 0}, ["name", "company"], as_dict=True
		)
		if not gl_account:
			raise unittest.SkipTest("Needs a Bank-type ledger account")

		if not frappe.db.exists("Bank", BANK):
			frappe.get_doc({"doctype": "Bank", "bank_name": BANK}).insert()

		cls.bank_account = frappe.get_doc(
			{
				"doctype": "Bank Account",
				"account_name": "_Test Mint Statement",
				"bank": BANK,
				"bank_account_no": "000111222333",
				"is_company_account": 1,
				"company": gl_account.company,
				"account": gl_account.name,
			}
		).insert(ignore_if_duplicate=True)

		# (date, withdrawal, deposit); the first and last fall outside the exported range
		for date, withdrawal, deposit in (
			("2026-03-07", 0, 999),
			("2026-03-08", 0, 5.40),
			("2026-03-08", 6.40, 0),
			("2026-03-09", 0, 594690),
			("2026-03-09", 11912, 0),
			("2026-03-10", 0, 777),
		):
			frappe.get_doc(
				{
					"doctype": "Bank Transaction",
					"bank_account": cls.bank_account.name,
					"company": gl_account.company,
					"date": date,
					"withdrawal": withdrawal,
					"deposit": deposit,
					"description": f"Txn {date} {withdrawal or deposit}",
				}
			).submit()

	def get_data(self, opening=2000):
		with patch("mint.apis.statement_export.get_account_balance", return_value=opening) as balance:
			data = get_statement_data(self.bank_account.name, "2026-03-08", "2026-03-09")
		# Opening balance is the balance at the end of the day before From Date
		self.assertEqual(getdate(balance.call_args.args[1]), getdate("2026-03-07"))
		return data

	def test_rows_and_totals_tie_out(self):
		data = self.get_data()

		self.assertEqual(len(data.rows), 4)
		self.assertEqual([r.date for r in data.rows], sorted(r.date for r in data.rows))
		self.assertEqual(data.total_debit, 11918.40)
		self.assertEqual(data.total_credit, 594695.40)
		self.assertEqual(data.opening_balance, 2000)
		self.assertAlmostEqual(data.closing_balance, 2000 + 594695.40 - 11918.40, places=2)

		first = data.rows[0]
		self.assertEqual(first.weekday, "Sunday")
		self.assertEqual(first.bs_date, format_bs("2026-03-08", "YYYY-MM-DD"))
		# A withdrawal is a debit on the bank statement, a deposit a credit
		self.assertEqual((first.debit, first.credit), (0, 5.40))
		self.assertEqual((data.rows[1].debit, data.rows[1].credit), (6.40, 0))

	def test_workbook_layout(self):
		data = self.get_data()
		ws = load_workbook(BytesIO(build_statement_workbook(data))).active

		header_row = next(r for r in ws.iter_rows() if r[0].value == "Date (AD)")
		headers = [c.value for c in header_row]
		self.assertEqual(
			headers, ["Date (AD)", "Date (BS)", "Day", "Description", "Debit Amount", "Credit Amount"]
		)
		for unwanted in ("Balance", "Value Date", "Cheque No"):
			self.assertNotIn(unwanted, headers)
		self.assertTrue(header_row[0].font.bold)
		self.assertEqual(header_row[0].fill.start_color.rgb[-6:], "C5DCF5")

		details = {r[0].value: r[1].value for r in ws.iter_rows(max_row=header_row[0].row) if r[0].value}
		self.assertIn(BANK, details["Bank Name"])
		self.assertIn("000111222333", details["Bank Account"])
		self.assertIn("2026-03-08", details["From Date"])
		self.assertIn("2026-03-09", details["To Date"])
		self.assertIn(frappe.utils.get_fullname(frappe.session.user), details["Downloaded By"])
		self.assertTrue(details["Downloaded On"])

		by_label = {r[3].value: r for r in ws.iter_rows(min_row=header_row[0].row + 1)}
		self.assertEqual(by_label["Opening Balance"][4].value, 2000)
		self.assertEqual(by_label["Closing Balance"][4].value, data.closing_balance)
		self.assertEqual(by_label["Total"][4].value, data.total_debit)
		self.assertEqual(by_label["Total"][5].value, data.total_credit)
		self.assertIn("#,##0.00", by_label["Total"][4].number_format)

	def test_opening_balance_from_statement_balance(self):
		# Saved bank balance on 6 Mar; the 7 Mar deposit of 999 comes after it, and the
		# balance saved on From Date itself is not "before" the period
		self.addCleanup(frappe.db.delete, "Mint Bank Statement Balance", {"bank_account": self.bank_account.name})
		for date, balance in (("2026-03-06", 1000), ("2026-03-08", 5)):
			frappe.get_doc(
				{
					"doctype": "Mint Bank Statement Balance",
					"bank_account": self.bank_account.name,
					"date": date,
					"balance": balance,
				}
			).insert()

		with patch("mint.apis.statement_export.get_account_balance") as gl_balance:
			data = get_statement_data(self.bank_account.name, "2026-03-08", "2026-03-09")

		gl_balance.assert_not_called()
		self.assertEqual(data.opening_balance, 1999)
		self.assertAlmostEqual(data.closing_balance, 1999 + 594695.40 - 11918.40, places=2)

	def test_needs_bank_account_permission(self):
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				get_statement_data(self.bank_account.name, "2026-03-08", "2026-03-09")
		finally:
			frappe.set_user("Administrator")

	def test_rejects_reversed_dates(self):
		with self.assertRaises(frappe.ValidationError):
			get_statement_data(self.bank_account.name, "2026-03-09", "2026-03-08")
