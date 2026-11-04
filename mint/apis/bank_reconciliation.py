import frappe
from frappe import _
import json
import datetime
from erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool import create_payment_entry_bts, create_journal_entry_bts, check_matching, subtract_allocations
from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import get_accounting_dimensions
from erpnext.accounts.party import get_party_account
from erpnext import get_default_cost_center
from frappe.utils import cint, flt, getdate


def _parse_optional_amount(value):
	"""Parse an amount filter, preserving 0 (unlike a truthiness check)."""
	if value is None or value == "":
		return None
	return flt(value)


def _voucher_party_matches(voucher, party: str) -> bool:
	voucher_party = voucher.get("party") or ""
	if voucher_party == party:
		return True

	# Journal Entry matching exposes pay_to_recd_from as party (free text),
	# so allow a case-insensitive contains match for that doctype only.
	if voucher.get("doctype") == "Journal Entry" and party.lower() in voucher_party.lower():
		return True

	return False


def _voucher_in_date_range(voucher, from_date, to_date) -> bool:
	"""Post-filter by posting/reference date.

	ERPNext applies date filters in SQL for Payment Entry / Journal Entry,
	but Sales Invoice, Purchase Invoice, and Bank Transaction queries ignore
	from_date/to_date - so we enforce the range here for all doctypes.
	"""
	if not from_date and not to_date:
		return True

	raw_date = voucher.get("posting_date") or voucher.get("reference_date")
	if not raw_date:
		return True

	voucher_date = getdate(raw_date)
	if from_date and voucher_date < getdate(from_date):
		return False
	if to_date and voucher_date > getdate(to_date):
		return False
	return True


@frappe.whitelist()
def clear_clearing_date(voucher_type: str, voucher_name: str):
    """
        Clear the clearing date of a voucher
    """
    # using db_set to trigger notification
    payment_entry = frappe.get_doc(voucher_type, voucher_name)

    if payment_entry.has_permission("write"):
        payment_entry.db_set("clearance_date", None)


@frappe.whitelist()
def reconcile_vouchers(bank_transaction_name: str | int, vouchers: str, is_new_voucher: bool = False):
	 
    # updated clear date of all the vouchers based on the bank transaction
    vouchers = json.loads(vouchers)
    transaction = frappe.get_doc("Bank Transaction", bank_transaction_name)
    
    # Add the vouchers with zero allocation. Save() will perform the allocations and clearance
    # We are overriding the default behavior of the method to set the reconciliation type
    if 0.0 >= transaction.unallocated_amount:
        frappe.throw(_("Bank Transaction {0} is already fully reconciled").format(transaction.name))
    
    for voucher in vouchers:
        transaction.append(
            "payment_entries",
            {
                "payment_document": voucher["payment_doctype"],
                "payment_entry": voucher["payment_name"],
                "allocated_amount": 0.0,  # Temporary
                "reconciliation_type": "Voucher Created" if is_new_voucher else "Matched",
            },
        )
    transaction.validate_duplicate_references()
    transaction.allocate_payment_entries()
    transaction.update_allocated_amount()
    transaction.set_status()
    transaction.save()
    
    return transaction

@frappe.whitelist()
def unreconcile_transaction(transaction_name: str | int):
    """
        Unreconcile an entire bank transaction - so this does not handle individual entries

        If the individual entries in the bank transaction are matched, just remove the payment entries
        Else, cancel the individual entries
    """
    transaction = frappe.get_doc("Bank Transaction", transaction_name)

    vouchers_to_cancel = []

    for entry in transaction.payment_entries:
        if entry.reconciliation_type == "Voucher Created":
            vouchers_to_cancel.append({
                "doctype": entry.payment_document,
                "name": entry.payment_entry,
            })
            
    transaction.remove_payment_entries()

    for voucher in vouchers_to_cancel:
        frappe.get_doc(voucher["doctype"], voucher["name"]).cancel()

@frappe.whitelist()
def undo_reconciliation_action(bank_transaction_id: str | int, voucher_type: str, voucher_id: str | int):
    """
     API to remove a single reconciliation action - for example only undoing one voucher instead of undoing the entire transaction
    """

    bank_transaction = frappe.get_doc("Bank Transaction", bank_transaction_id)

    # Find the voucher in the bank transaction and depending on the action, either remove it or cancel the voucher
    for entry in bank_transaction.payment_entries:
        if entry.payment_document == voucher_type and entry.payment_entry == voucher_id:
            if entry.reconciliation_type  == "Voucher Created":
                frappe.get_doc(voucher_type, voucher_id).cancel()
            else:
                bank_transaction.remove_payment_entry(entry)
                bank_transaction.save()

    return {
        "success": True,
    }


@frappe.whitelist(methods=["POST"])
def create_bulk_internal_transfer(bank_transaction_names: list[str|int], 
                                  bank_account: str):
    """
        Create an internal transfer for multiple bank transactions
    """
    output = []

    for bank_transaction_name in bank_transaction_names:

        bank_transaction = frappe.db.get_value("Bank Transaction", bank_transaction_name, ["name", "withdrawal", "bank_account", "date", "reference_number", "description"], as_dict=True)

        transaction_account = frappe.get_cached_value("Bank Account", bank_transaction.bank_account, "account")

        is_withdrawal = bank_transaction.withdrawal > 0.0

        if is_withdrawal:
            paid_from = transaction_account
            paid_to = bank_account
        else:
            paid_from = bank_account
            paid_to = transaction_account
        
        reference_no = (bank_transaction.reference_number or bank_transaction.description or '')[:140]
        
        final_transaction = create_internal_transfer(bank_transaction_name=bank_transaction.name,
                                 posting_date=bank_transaction.date,
                                 reference_date=bank_transaction.date,
                                 reference_no=reference_no,
                                 paid_from=paid_from,
                                 paid_to=paid_to,)
        
        output.append(final_transaction)
    
    return output

def get_bank_charge_dimension(bank_account: str) -> str | None:
    """
    Return the Bank to tag on a bank charge via the "Bank Charge" accounting dimension.

    Returns None (without raising) if the dimension is absent/disabled, or if the
    bank account's bank is not a valid option (Bank record) for the dimension.
    """
    if "bank_charge" not in get_accounting_dimensions():
        return None

    bank = frappe.get_cached_value("Bank Account", bank_account, "bank")

    if bank and frappe.db.exists("Bank", bank):
        return bank

    return None


@frappe.whitelist()
def create_internal_transfer(bank_transaction_name: str|int,
                             posting_date: str | datetime.date,
                             reference_date: str | datetime.date,
                             reference_no: str,
                             paid_from: str,
                             paid_to: str,
                             custom_remarks: bool = False,
                             remarks: str = None,
                             mirror_transaction_name: str | int = None,
                             dimensions: dict = None,
                             bank_charge_amount: float = 0,
                             bank_charge_account: str = None,
                             bank_charge_cost_center: str = None):
    """
    Create an internal transfer payment entry
    """

    bank_transaction = frappe.get_doc("Bank Transaction", bank_transaction_name)

    bank_account = frappe.get_cached_value("Bank Account", bank_transaction.bank_account, "account")
    company = frappe.get_cached_value("Account", bank_account, "company")

    is_withdrawal = bank_transaction.withdrawal > 0.0

    charge = flt(bank_charge_amount)

    if charge > 0:
        if not bank_charge_account:
            frappe.throw(_("Bank Charge Account is required when a bank charge is applied."))

        if not bank_charge_cost_center:
            bank_charge_cost_center = frappe.db.get_single_value("Mint Settings", "bank_charge_cost_center")

        if not bank_charge_cost_center:
            # Cost Center is mandatory on Payment Entry Deduction rows
            frappe.throw(_("Bank Charge Cost Center is required when a bank charge is applied. Set a default in Mint Settings."))

        if is_withdrawal and charge >= bank_transaction.unallocated_amount:
            frappe.throw(_("Bank charge must be less than the transaction amount."))

    pe = frappe.new_doc("Payment Entry")

    pe.company = company
    pe.payment_type = "Internal Transfer"
    pe.posting_date = posting_date
    pe.reference_date = reference_date
    pe.reference_no = reference_no
    pe.custom_remarks = custom_remarks

    if charge > 0:
        if is_withdrawal:
            # The source bank statement shows the full withdrawal; the
            # destination receives the amount net of the charge.
            pe.paid_amount = bank_transaction.unallocated_amount
            pe.received_amount = bank_transaction.unallocated_amount - charge
        else:
            pe.received_amount = bank_transaction.unallocated_amount
            pe.paid_amount = bank_transaction.unallocated_amount + charge
    else:
        pe.paid_amount = bank_transaction.unallocated_amount
        pe.received_amount = bank_transaction.unallocated_amount

    # TODO: Support multi-currency transactions
    pe.target_exchange_rate = 1.0

    if custom_remarks:
        pe.remarks = remarks

    if dimensions:
        pe.update(dimensions)

    if is_withdrawal:
         pe.paid_to = paid_to
         pe.paid_from = bank_account
    else:
         pe.paid_from = paid_from
         pe.paid_to = bank_account

    if charge > 0:
        deduction = {
            "account": bank_charge_account,
            "amount": charge,
            "cost_center": bank_charge_cost_center,
            # ERPNext books the paid/received difference of an internal transfer
            # into an exchange gain/loss row - flagging the charge row makes it
            # reuse this row instead of adding a second one.
            "is_exchange_gain_loss": 1,
        }

        dimension_bank = get_bank_charge_dimension(bank_transaction.bank_account)
        if dimension_bank:
            deduction["bank_charge"] = dimension_bank

        pe.append("deductions", deduction)

    pe.insert()
    pe.submit()

    vouchers = json.dumps(
		[
			{
				"payment_doctype": "Payment Entry",
				"payment_name": pe.name,
				"amount": bank_transaction.unallocated_amount,
			}
		]
	)

    transaction_id = reconcile_vouchers(bank_transaction_name, vouchers, is_new_voucher=True)

    if mirror_transaction_name:
        # Reconcile the mirror transaction
        reconcile_vouchers(mirror_transaction_name, vouchers, is_new_voucher=False)

    return {
        "transaction": transaction_id,
        "payment_entry": pe,
    }

@frappe.whitelist(methods=['POST'])
def create_bulk_bank_entry_and_reconcile(bank_transactions: list[str|int], 
                                         account: str):
    """
     Create bank entries for all transactions and reconcile them
    """

    output = []

    for bank_transaction in bank_transactions:
        transactions_details = frappe.db.get_value("Bank Transaction", bank_transaction, ["name", "deposit", "withdrawal", "bank_account", "currency", "unallocated_amount", "date", "reference_number", "description"], as_dict=True)

        is_credit_card = frappe.get_cached_value("Bank Account", transactions_details.bank_account, "is_credit_card")

        # Check Number will be limited to 140 characters
        cheque_no = (transactions_details.reference_number or transactions_details.description or '')[:140]

        is_withdrawal = transactions_details.withdrawal > 0.0

        entries = []

        gl_account = frappe.get_cached_value("Bank Account", transactions_details.bank_account, "account")

        if is_withdrawal:
            entries.append({
                "account": gl_account,
                "bank_account": transactions_details.bank_account,
                "credit_in_account_currency": transactions_details.unallocated_amount,
                "credit": transactions_details.unallocated_amount,
                "debit_in_account_currency": 0,
                "debit": 0,
            })

            entries.append({
                "account": account,
                "credit": 0,
                "debit": transactions_details.unallocated_amount,
            })
        else:
            entries.append({
                "account": gl_account,
                "bank_account": transactions_details.bank_account,
                "debit_in_account_currency": transactions_details.unallocated_amount,
                "debit": transactions_details.unallocated_amount,
                "credit_in_account_currency": 0,
                "credit": 0,
            })

            entries.append({
                "account": account,
                "debit": 0,
                "credit": transactions_details.unallocated_amount,
            })

        final_transaction = create_bank_entry_and_reconcile(bank_transaction_name=bank_transaction,
                                        cheque_date=transactions_details.date,
                                        posting_date=transactions_details.date,
                                        cheque_no=cheque_no,
                                        user_remark=transactions_details.description,
                                        entries=entries,
                                        voucher_type=("Credit Card Entry" if is_credit_card else "Bank Entry"))
        
        output.append(final_transaction)
    
    return output



@frappe.whitelist(methods=['POST'])
def create_bank_entry_and_reconcile(bank_transaction_name: str | int, 
                                    cheque_date: str | datetime.date,
                                    posting_date: str | datetime.date,
                                    cheque_no: str,
                                    entries: list,
                                    user_remark: str = None,
                                    voucher_type: str = "Bank Entry",
                                    dimensions: dict = None):
    """
        Create a bank entry and reconcile it with the bank transaction
    """
    # Create a new journal entry based on the bank transaction
    bank_transaction = frappe.db.get_values(
        "Bank Transaction",
        bank_transaction_name,
        fieldname=["name", "deposit", "withdrawal", "bank_account", "currency", "unallocated_amount"],
        as_dict=True,
    )[0]

    bank_account = frappe.get_cached_value("Bank Account", bank_transaction.bank_account, "account")
    company = frappe.get_cached_value("Account", bank_account, "company")

    default_cost_center = get_default_cost_center(company)

    bank_entry = frappe.get_doc({
        "doctype": "Journal Entry",
        "voucher_type": voucher_type,
        "company": company,
        "cheque_date": cheque_date,
        "posting_date": posting_date,
        "cheque_no": cheque_no,
        "user_remark": user_remark,
    })
    
    if not dimensions:
        dimensions = {}
    
    for entry in entries:
        # Check if this account is a Income or Expense Account
        # If it is, and no cost center is added, select the company default cost center
        cost_center = entry.get("cost_center")

        if not cost_center:
            report_type = frappe.get_cached_value("Account", entry["account"], "report_type")
            if report_type == "Profit and Loss":
                # Cost center is required
                cost_center = default_cost_center
        
        bank_entry.append("accounts", {
            "account": entry["account"],
            # TODO: Multi currency support
            "debit_in_account_currency": entry.get("debit"),
            "credit_in_account_currency": entry.get("credit"),
            "debit": entry.get("debit"),
            "credit": entry.get("credit"),
            "party_type": entry.get("party_type") if entry.get("party") else None,
            "party": entry.get("party"),
            "user_remark": entry.get("user_remark"),
            **entry,
            "cost_center": cost_center
        })

    bank_entry.insert()
    bank_entry.submit()

    if bank_transaction.deposit > 0.0:
        paid_amount = bank_transaction.deposit
    else:
        paid_amount = bank_transaction.withdrawal

    transaction = reconcile_vouchers(bank_transaction_name, json.dumps([{
        "payment_doctype": "Journal Entry",
        "payment_name": bank_entry.name,
        "amount": paid_amount,
    }]), is_new_voucher=True)

    return {
        "transaction": transaction,
        "journal_entry": bank_entry,
    }

@frappe.whitelist(methods=['POST'])
def create_bulk_payment_entry_and_reconcile(bank_transaction_names: list[str | int], 
                                            party_type: str, 
                                            party: str | int, 
                                            account: str,
                                            mode_of_payment: str | None = None):
    """
        Create a payment entry and reconcile it with the bank transaction
    """

    output = []

    for bank_transaction_name in bank_transaction_names:
        bank_transaction = frappe.db.get_value("Bank Transaction", bank_transaction_name, ["name", "deposit", "withdrawal", "bank_account", "currency", "unallocated_amount", "date", "reference_number", "description"], as_dict=True)

        transaction_account = frappe.get_cached_value("Bank Account", bank_transaction.bank_account, "account")

        is_withdrawal = bank_transaction.withdrawal > 0.0

        if is_withdrawal:
            paid_from = transaction_account
            paid_to = account
        else:
            paid_from = account
            paid_to = transaction_account
        
        payment_entry_doc = frappe.get_doc({
            "doctype": "Payment Entry",
            "payment_type": "Pay" if is_withdrawal else "Receive",
            "bank_account": bank_transaction.bank_account,
            "company": bank_transaction.company,
            "mode_of_payment": mode_of_payment,
            "party_type": party_type,
            "party": party,
            "paid_from": paid_from,
            "paid_to": paid_to,
            "paid_amount": bank_transaction.unallocated_amount,
            "base_paid_amount": bank_transaction.unallocated_amount,
            "received_amount": bank_transaction.unallocated_amount,
            "base_received_amount": bank_transaction.unallocated_amount,
            "target_exchange_rate": 1,
            "source_exchange_rate": 1,
            "reference_date": bank_transaction.date,
            "posting_date": bank_transaction.date,
            "reference_no": (bank_transaction.reference_number or bank_transaction.description or '')[:140],
        })

        payment_entry_doc.insert()
        payment_entry_doc.submit()

        final_transaction = reconcile_vouchers(bank_transaction_name, json.dumps([{
            "payment_doctype": "Payment Entry",
            "payment_name": payment_entry_doc.name,
            "amount": payment_entry_doc.paid_amount,
        }]), is_new_voucher=True)

        output.append({
            "transaction": final_transaction,
            "payment_entry": payment_entry_doc,
        })

    return output

    
@frappe.whitelist(methods=['POST'])
def create_payment_entry_and_reconcile(bank_transaction_name: str | int, 
                                       payment_entry_doc: dict):
    """
        Create a payment entry and reconcile it with the bank transaction
    """
    payment_entry = frappe.get_doc({
        **payment_entry_doc,
        "doctype": "Payment Entry",
    })
    payment_entry.insert()
    payment_entry.submit()
    transaction = reconcile_vouchers(bank_transaction_name, json.dumps([{
        "payment_doctype": "Payment Entry",
        "payment_name": payment_entry.name,
        "amount": payment_entry.paid_amount,
    }]), is_new_voucher=True)

    return {
        "transaction": transaction,
        "payment_entry": payment_entry,
    }


@frappe.whitelist(methods=['GET'])
def get_account_defaults(account: str):
    """
        Get the default cost center and write off account for an account
    """
    company, report_type = frappe.db.get_value("Account", account, ["company", "report_type"])

    return get_default_cost_center(company) if report_type == "Profit and Loss" else  ""


@frappe.whitelist(methods=["GET"])
def get_party_details(company: str, party_type: str, party: str | int):

    if not frappe.db.exists(party_type, party):
        frappe.throw(_("{0} {1} does not exist").format(party_type, party))

    party_account = get_party_account(party_type, party, company)
    _party_name = "title" if party_type == "Shareholder" else party_type.lower() + "_name"
    party_name = frappe.db.get_value(party_type, party, _party_name)

    return {
        "party_account": party_account,
        "party_name": party_name,
    }

@frappe.whitelist(methods=["GET"])
def search_for_transfer_transaction(transaction_id: str | int):
    """
    When users try to create a transfer, we could help them by searching for the mirror transaction.

    So for a withdrawal of 1000, we could search for a deposit of 1000 on the same date.

    If the mirror transaction is found, we return the bank account and account details.
    """
    company, withdrawal, deposit, date, bank_account = frappe.db.get_value("Bank Transaction", transaction_id, ["company", "withdrawal", "deposit", "date", "bank_account"])

    
    days = frappe.db.get_single_value("Mint Settings", "transfer_match_days")

    if not days:
        days = 4

    min_date = frappe.utils.add_days(date, -days)
    max_date = frappe.utils.add_days(date, days)
    mirror_tx = frappe.db.get_list("Bank Transaction", filters={
        "company": company,
        "date": ["between", [min_date, max_date]],
        "withdrawal": deposit,
        "bank_account": ["!=", bank_account],
        "deposit": withdrawal,
        "docstatus": 1,
        "status": "Unreconciled",
    }, fields=["name", "bank_account", "reference_number", "date", "description", "withdrawal", "deposit", "currency"])

    if len(mirror_tx) == 1:
        return {
            "name": mirror_tx[0].name,
            "reference_number": mirror_tx[0].reference_number,
            "description": mirror_tx[0].description,
            "currency": mirror_tx[0].currency,
            "withdrawal": mirror_tx[0].withdrawal,
            "deposit": mirror_tx[0].deposit,
            "date": mirror_tx[0].date,
            "bank_account": mirror_tx[0].bank_account,
            "account": frappe.get_cached_value("Bank Account", mirror_tx[0].bank_account, "account"),
        }

    return None


@frappe.whitelist()
def get_linked_payments(
	bank_transaction_name,
	document_types=None,
	from_date=None,
	to_date=None,
	filter_by_reference_date=None,
	from_reference_date=None,
	to_reference_date=None,
	party=None,
	min_amount=None,
	max_amount=None,
):
	# get all matching payments for a bank transaction
	transaction = frappe.get_doc("Bank Transaction", bank_transaction_name)
	bank_account = frappe.db.get_values(
		"Bank Account", transaction.bank_account, ["account", "company"], as_dict=True
	)[0]
	(gl_account, company) = (bank_account.account, bank_account.company)
	
	if isinstance(document_types, str):
		document_types = json.loads(document_types)

	# Ignore unsupported document types that may still be in client state
	if document_types:
		document_types = [dt for dt in document_types if dt != "expense_claim"]

	matching = check_matching(
		gl_account,
		company,
		transaction,
		document_types,
		from_date,
		to_date,
		filter_by_reference_date,
		from_reference_date,
		to_reference_date,
	)

	# ERPNext v15's check_matching does not support party/min_amount/max_amount,
	# and SI/PI/BT queries ignore date filters - apply them here.
	if party:
		matching = [voucher for voucher in matching if _voucher_party_matches(voucher, party)]

	if from_date or to_date:
		matching = [
			voucher for voucher in matching if _voucher_in_date_range(voucher, from_date, to_date)
		]

	min_amount = _parse_optional_amount(min_amount)
	max_amount = _parse_optional_amount(max_amount)

	if min_amount is not None:
		matching = [voucher for voucher in matching if flt(voucher.get("paid_amount")) >= min_amount]

	if max_amount is not None:
		matching = [voucher for voucher in matching if flt(voucher.get("paid_amount")) <= max_amount]

	return subtract_allocations(gl_account, matching)


# Wide window used when searching, so vouchers outside the selected dates are found
SEARCH_FROM_DATE = "1900-01-01"
SEARCH_TO_DATE = "2999-12-31"
SEARCH_RESULT_LIMIT = 200


def _internal_transfers_for_transaction(gl_account, company, transaction, exact_match=False, exclude=None):
	"""
	Uncleared Internal Transfer Payment Entries into (deposit) or out of (withdrawal)
	this bank account, from any date. Transfers are often booked on a different day
	from when the bank shows them (e.g. courier COD remittances), so the voucher date
	range would otherwise hide them.
	"""
	is_deposit = flt(transaction.deposit) > 0
	account_field = "paid_to" if is_deposit else "paid_from"
	currency_field = "paid_to_account_currency" if is_deposit else "paid_from_account_currency"
	exclude = set(exclude or [])

	rows = frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"company": company,
			"payment_type": "Internal Transfer",
			account_field: gl_account,
			"clearance_date": ["is", "not set"],
		},
		fields=[
			"name",
			"base_paid_amount_after_tax as paid_amount",
			"reference_no",
			"reference_date",
			"posting_date",
			f"{currency_field} as currency",
		],
		order_by="posting_date desc",
		limit=100,
	)

	vouchers = []
	for row in rows:
		if row.name in exclude:
			continue
		amount_matches = flt(row.paid_amount) == flt(transaction.unallocated_amount)
		if exact_match and not amount_matches:
			continue
		ref_matches = bool(row.reference_no) and row.reference_no == transaction.reference_number
		vouchers.append(
			frappe._dict(
				rank=1 + int(amount_matches) + int(ref_matches),
				doctype="Payment Entry",
				name=row.name,
				paid_amount=row.paid_amount,
				reference_no=row.reference_no,
				reference_date=row.reference_date,
				party=None,
				party_type=None,
				posting_date=row.posting_date,
				currency=row.currency,
			)
		)
	return vouchers


def _voucher_matches_search(voucher, search: str) -> bool:
	"""Case-insensitive match on voucher name, reference, party or amount."""
	needle = search.strip().lower()
	if not needle:
		return True

	for field in ("name", "reference_no", "party"):
		if needle in str(voucher.get(field) or "").lower():
			return True

	amount_needle = needle.replace(",", "")
	try:
		float(amount_needle)
	except ValueError:
		return False
	amount = flt(voucher.get("paid_amount"))
	return amount_needle in (f"{amount:.2f}", f"{amount:g}", str(int(amount)))


@frappe.whitelist()
def get_vouchers_for_transaction(
	bank_transaction_name,
	document_types=None,
	from_date=None,
	to_date=None,
	party=None,
	min_amount=None,
	max_amount=None,
	search=None,
):
	"""
	Voucher candidates for the Match panel.
	Same as get_linked_payments, plus Internal Transfers from any date, and a
	search that looks across all dates when search text is given.
	"""
	if isinstance(document_types, str):
		document_types = json.loads(document_types)
	document_types = [dt for dt in (document_types or ["payment_entry", "journal_entry"]) if dt != "expense_claim"]

	search = (search or "").strip()
	if search:
		from_date, to_date = SEARCH_FROM_DATE, SEARCH_TO_DATE

	matching = get_linked_payments(
		bank_transaction_name,
		document_types=document_types,
		from_date=from_date,
		to_date=to_date,
		filter_by_reference_date=0,
		party=party,
		min_amount=min_amount,
		max_amount=max_amount,
	)

	if "payment_entry" in document_types and not party:
		transaction = frappe.get_doc("Bank Transaction", bank_transaction_name)
		bank_account = frappe.db.get_values(
			"Bank Account", transaction.bank_account, ["account", "company"], as_dict=True
		)[0]
		transfers = _internal_transfers_for_transaction(
			bank_account.account,
			bank_account.company,
			transaction,
			exact_match="exact_match" in document_types,
			exclude={v.get("name") for v in matching if v.get("doctype") == "Payment Entry"},
		)
		min_value = _parse_optional_amount(min_amount)
		max_value = _parse_optional_amount(max_amount)
		transfers = [
			t
			for t in transfers
			if (min_value is None or flt(t.paid_amount) >= min_value)
			and (max_value is None or flt(t.paid_amount) <= max_value)
		]
		matching += subtract_allocations(bank_account.account, transfers)

	if search:
		matching = [v for v in matching if _voucher_matches_search(v, search)][:SEARCH_RESULT_LIMIT]

	return sorted(matching, key=lambda v: -cint(v.get("rank")))
