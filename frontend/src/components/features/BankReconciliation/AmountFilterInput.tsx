import { Input } from "@/components/ui/input"
import { getCurrencySymbol } from "@/lib/currency"
import { getCurrencyFormatInfo } from "@/lib/numbers"
import _ from "@/lib/translate"
import CurrencyInput from "react-currency-input-field"

export interface AmountFilter {
    value: number
    stringValue?: string | number
}

/** Currency input used to filter a list down to rows with an exact amount */
const AmountFilterInput = ({ currency, amountFilter, setAmountFilter }: {
    currency: string,
    amountFilter: AmountFilter,
    setAmountFilter: (value: AmountFilter) => void
}) => {
    const currencySymbol = getCurrencySymbol(currency)
    const formatInfo = getCurrencyFormatInfo(currency)
    const groupSeparator = formatInfo.group_sep || ","
    const decimalSeparator = formatInfo.decimal_str || "."

    return <>
        <label className="sr-only">{_("Filter by amount")}</label>
        <CurrencyInput
            groupSeparator={groupSeparator}
            decimalSeparator={decimalSeparator}
            placeholder={`${currencySymbol}0${decimalSeparator}00`}
            decimalsLimit={2}
            value={amountFilter.stringValue}
            maxLength={12}
            decimalScale={2}
            prefix={currencySymbol}
            onValueChange={(v, _n, values) => {
                // If the input ends with a decimal or a decimal with trailing zeroes, store the string since we need the user to be able to type the decimals.
                // When the user eventually types the decimals or blurs out, the value is formatted anyway.
                // Otherwise store the float value
                const isDecimal = v?.endsWith(decimalSeparator) || v?.endsWith(decimalSeparator + '0')
                const newValue = isDecimal ? v : values?.float ?? ''
                setAmountFilter({
                    value: Number(newValue),
                    stringValue: newValue
                })
            }}
            customInput={Input}
        />
    </>
}

export default AmountFilterInput
