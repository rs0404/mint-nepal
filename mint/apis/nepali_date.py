import frappe
from frappe.utils import getdate, today
from nepal_compliance.nepali_date_utils import nepali_date as nepal_date
from nepal_compliance.nepali_date_utils.nepali_date import (
	ad_to_bs,
	bs_to_ad,
	format_bs,
	NEPALI_MONTHS,
)

# Nepali fiscal year starts in Shrawan (month 4). Quarters:
# Q1 Shrawan–Ashwin (4–6), Q2 Kartik–Poush (7–9),
# Q3 Magh–Chaitra (10–12), Q4 Baisakh–Ashadh (1–3 next year).
NEPALI_FY_START_MONTH = 4


def _days_in_bs_month(year: int, month: int) -> int:
	nepal_date._ensure_loaded()
	return nepal_date._bs_months[year][month - 1]


def _bs_month_range(year: int, month: int) -> tuple[str, str]:
	start = bs_to_ad(year, month, 1)
	end = bs_to_ad(year, month, _days_in_bs_month(year, month))
	return str(start), str(end)


def _add_bs_months(year: int, month: int, offset: int) -> tuple[int, int]:
	"""Add (possibly negative) months to a BS year/month (1-based)."""
	idx = (year * 12 + (month - 1)) + offset
	return idx // 12, (idx % 12) + 1


def _nepali_fy_start(bs_year: int, bs_month: int) -> tuple[int, int]:
	"""Return (fy_start_year, Shrawan=4) for the Nepali FY containing this BS date."""
	if bs_month >= NEPALI_FY_START_MONTH:
		return bs_year, NEPALI_FY_START_MONTH
	return bs_year - 1, NEPALI_FY_START_MONTH


def _quarter_range(fy_start_year: int, quarter: int) -> tuple[str, str, str]:
	"""Return (from_ad, to_ad, label) for Q1–Q4 of a Nepali FY starting Shrawan fy_start_year."""
	# Q1 starts at Shrawan of fy_start_year; each quarter is 3 months
	start_month_offset = (quarter - 1) * 3
	y, m = _add_bs_months(fy_start_year, NEPALI_FY_START_MONTH, start_month_offset)
	end_y, end_m = _add_bs_months(y, m, 2)
	from_ad, _ = _bs_month_range(y, m)
	_, to_ad = _bs_month_range(end_y, end_m)
	fy_label = f"{fy_start_year}/{str(fy_start_year + 1)[-2:]}"
	return from_ad, to_ad, f"Q{quarter}: {fy_label}"


@frappe.whitelist(methods=["GET"])
def ad_to_bs_date(ad_date: str | None = None):
	"""Convert an AD date (YYYY-MM-DD) to BS components + formatted strings."""
	ad = getdate(ad_date or today())
	bs = ad_to_bs(ad)
	return {
		"ad": str(ad),
		"year": bs["year"],
		"month": bs["month"],
		"day": bs["day"],
		"month_name": NEPALI_MONTHS[bs["month"]],
		"bs": format_bs(ad, "YYYY-MM-DD"),
		"bs_pretty": f"{bs['day']} {NEPALI_MONTHS[bs['month']]} {bs['year']}",
	}


@frappe.whitelist(methods=["GET"])
def bs_to_ad_date(bs_date: str = None, year: int = None, month: int = None, day: int = None):
	"""Convert a BS date (YYYY-MM-DD or year/month/day) to AD YYYY-MM-DD."""
	if bs_date:
		year, month, day = [int(x) for x in str(bs_date).split("-")]
	if not (year and month and day):
		frappe.throw("Provide bs_date or year, month, and day")
	return {"ad": str(bs_to_ad(int(year), int(month), int(day)))}


@frappe.whitelist(methods=["GET"])
def get_period_dates(period: str, calendar: str = "BS", base_date: str | None = None):
	"""
	Return AD from/to for a named period.

	When calendar=BS, months/quarters/years follow Bikram Sambat
	(Nepali FY quarters start in Shrawan). When calendar=AD, Gregorian.
	"""
	calendar = (calendar or "BS").upper()
	ad_base = getdate(base_date or today())

	if calendar == "AD":
		return _ad_period_dates(period, ad_base)

	bs = ad_to_bs(ad_base)
	year, month = bs["year"], bs["month"]

	if period in ("This Month", "Date Range"):
		from_ad, to_ad = _bs_month_range(year, month)
		return _period_result(from_ad, to_ad, period, "BS")

	if period == "Last Month":
		y, m = _add_bs_months(year, month, -1)
		from_ad, to_ad = _bs_month_range(y, m)
		return _period_result(from_ad, to_ad, period, "BS")

	if period == "This Week":
		# ISO week still uses AD week boundaries (no BS week calendar)
		return _ad_period_dates(period, ad_base)

	if period == "Last Week":
		return _ad_period_dates(period, ad_base)

	if period == "This Quarter":
		fy_year, _ = _nepali_fy_start(year, month)
		months_from_start = ((month - NEPALI_FY_START_MONTH) % 12)
		quarter = months_from_start // 3 + 1
		from_ad, to_ad, _label = _quarter_range(fy_year, quarter)
		return _period_result(from_ad, to_ad, "This Quarter", "BS")

	if period == "Last Quarter":
		fy_year, _ = _nepali_fy_start(year, month)
		months_from_start = ((month - NEPALI_FY_START_MONTH) % 12)
		quarter = months_from_start // 3 + 1
		if quarter == 1:
			fy_year -= 1
			quarter = 4
		else:
			quarter -= 1
		from_ad, to_ad, _label = _quarter_range(fy_year, quarter)
		return _period_result(from_ad, to_ad, "Last Quarter", "BS")

	if period == "This Year" or period == "This Fiscal Year":
		fy_year, _ = _nepali_fy_start(year, month)
		from_ad, _ = _bs_month_range(fy_year, NEPALI_FY_START_MONTH)
		_, to_ad = _bs_month_range(fy_year + 1, NEPALI_FY_START_MONTH - 1)  # Ashadh
		return _period_result(from_ad, to_ad, period, "BS")

	if period == "Last Year" or period == "Last Fiscal Year":
		fy_year, _ = _nepali_fy_start(year, month)
		fy_year -= 1
		from_ad, _ = _bs_month_range(fy_year, NEPALI_FY_START_MONTH)
		_, to_ad = _bs_month_range(fy_year + 1, NEPALI_FY_START_MONTH - 1)
		return _period_result(from_ad, to_ad, period, "BS")

	# Explicit Q1–Q4 of current Nepali FY
	if period.startswith("Q") and len(period) >= 2 and period[1].isdigit():
		quarter = int(period[1])
		fy_year, _ = _nepali_fy_start(year, month)
		from_ad, to_ad, label = _quarter_range(fy_year, quarter)
		return _period_result(from_ad, to_ad, label, "BS")

	frappe.throw(f"Unknown period: {period}")


@frappe.whitelist(methods=["GET"])
def get_period_options(calendar: str = "BS", base_date: str | None = None):
	"""Return the period preset list for the Bank Rec date filter."""
	calendar = (calendar or "BS").upper()
	ad_base = getdate(base_date or today())

	if calendar == "AD":
		# Keep existing frontend AD logic; return empty so client uses local calc
		return {"calendar": "AD", "options": []}

	bs = ad_to_bs(ad_base)
	fy_year, _ = _nepali_fy_start(bs["year"], bs["month"])
	fy_label = f"{fy_year}/{str(fy_year + 1)[-2:]}"

	options = []

	for period in ("This Month", "Last Month"):
		result = get_period_dates(period, "BS", str(ad_base))
		options.append(result)

	for q in (1, 2, 3, 4):
		from_ad, to_ad, label = _quarter_range(fy_year, q)
		options.append(_period_result(from_ad, to_ad, label, "BS"))

	for period in ("This Fiscal Year", "Last Fiscal Year"):
		options.append(get_period_dates(period, "BS", str(ad_base)))

	for period in ("This Week", "Last Week", "This Quarter", "Last Quarter"):
		options.append(get_period_dates(period, "BS", str(ad_base)))

	return {
		"calendar": "BS",
		"bs_today": format_bs(ad_base, "YYYY-MM-DD"),
		"fy_label": fy_label,
		"options": options,
	}


def _period_result(from_ad: str, to_ad: str, label: str, calendar: str) -> dict:
	return {
		"label": label,
		"fromDate": from_ad,
		"toDate": to_ad,
		"fromDateBS": format_bs(from_ad, "YYYY-MM-DD"),
		"toDateBS": format_bs(to_ad, "YYYY-MM-DD"),
		"fromDatePretty": format_bs(from_ad, "DD M_NP YYYY") if calendar == "BS" else from_ad,
		"toDatePretty": format_bs(to_ad, "DD M_NP YYYY") if calendar == "BS" else to_ad,
		"calendar": calendar,
		"format": "YYYY-MM-DD",
	}


def _ad_period_dates(period: str, ad_base) -> dict:
	"""Gregorian period math mirrored from mint's frontend date.ts."""
	from dateutil.relativedelta import relativedelta
	import calendar as cal

	d = getdate(ad_base)

	def fmt(dt):
		return str(dt)

	if period == "This Week":
		start = d - __import__("datetime").timedelta(days=d.weekday())
		end = start + __import__("datetime").timedelta(days=6)
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period == "Last Week":
		start = d - __import__("datetime").timedelta(days=d.weekday() + 7)
		end = start + __import__("datetime").timedelta(days=6)
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period in ("This Month", "Date Range"):
		start = d.replace(day=1)
		last = cal.monthrange(d.year, d.month)[1]
		end = d.replace(day=last)
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period == "Last Month":
		prev = d.replace(day=1) - relativedelta(days=1)
		start = prev.replace(day=1)
		return _period_result(fmt(start), fmt(prev), period, "AD")

	if period == "This Quarter":
		q = (d.month - 1) // 3
		start = d.replace(month=q * 3 + 1, day=1)
		end_month = q * 3 + 3
		end = d.replace(month=end_month, day=cal.monthrange(d.year, end_month)[1])
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period == "Last Quarter":
		ref = d - relativedelta(months=3)
		q = (ref.month - 1) // 3
		start = ref.replace(month=q * 3 + 1, day=1)
		end_month = q * 3 + 3
		end = ref.replace(month=end_month, day=cal.monthrange(ref.year, end_month)[1])
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period in ("This Year", "This Fiscal Year"):
		start = d.replace(month=1, day=1)
		end = d.replace(month=12, day=31)
		return _period_result(fmt(start), fmt(end), period, "AD")

	if period in ("Last Year", "Last Fiscal Year"):
		y = d.year - 1
		return _period_result(f"{y}-01-01", f"{y}-12-31", period, "AD")

	frappe.throw(f"Unknown period: {period}")
