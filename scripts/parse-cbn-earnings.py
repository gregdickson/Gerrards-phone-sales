#!/usr/bin/env python3
"""
Parse CBN "Broker Earnings Detail" xlsx exports into a flat transactions JSON
for import into the broker_earnings table.

Each mapped file belongs to ONE broker (CBN exports are anonymous). Only files
present in --map are read, so partial-duplicate / subset files are excluded by
simply leaving them out of the map.

Column layout (0-based): 0=Tran.Number 1=Tran.Date 2=Client 4=Tran.Type
  5=Effective Date 6=Invoice 7=Broker Fee 9=Broker Commission
  11=Gross Broker Income (incl GST) 14=Net Broker Income

Usage:
  python parse-cbn-earnings.py --input-dir ~/Downloads \
     --map '{"...(5).xlsx":"Joshua Kalauta", ...}' --out /tmp/earnings.json
"""
import argparse, json, os
import openpyxl


def num(v):
    return float(v) if isinstance(v, (int, float)) else None


def iso(v):
    return v.isoformat() if hasattr(v, 'isoformat') else None


def parse_file(path, broker, base):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    out = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        c0 = row[0]
        if c0 is None:
            continue
        s = str(c0)
        if s.startswith('Client:') or s in ('Total', 'Grand Total'):
            continue
        try:
            int(c0)              # transaction rows have an integer Tran.Number
        except (ValueError, TypeError):
            continue
        out.append({
            'tranNumber': str(c0),
            'brokerName': broker,
            'sourceFile': base,
            'tranDate': iso(row[1]),
            'clientName': row[2],
            'tranType': row[4] or '?',
            'effectiveDate': iso(row[5]),
            'invoiceAmount': num(row[6]),
            'brokerFee': num(row[7]),
            'brokerCommission': num(row[9]),
            'grossBrokerIncome': num(row[11]),
            'netBrokerIncome': num(row[14]),
        })
    wb.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input-dir', required=True)
    ap.add_argument('--map', required=True, help='JSON basename->broker mapping')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    mapping = json.loads(a.map)
    rows = []
    summary = {}
    for base, broker in mapping.items():
        path = os.path.join(os.path.expanduser(a.input_dir), base)
        if not os.path.exists(path):
            raise SystemExit(f"Missing file: {path}")
        recs = parse_file(path, broker, base)
        rows.extend(recs)
        gbi = round(sum(r['grossBrokerIncome'] or 0 for r in recs))
        summary[broker] = {'tx': len(recs), 'gbi': gbi}

    json.dump(rows, open(a.out, 'w'))
    print(f"Wrote {len(rows)} transactions to {a.out}")
    for b, s in sorted(summary.items(), key=lambda x: -x[1]['gbi']):
        print(f"  {b:28s} tx={s['tx']:4d} GBI=${s['gbi']:>8,}")


if __name__ == '__main__':
    main()
