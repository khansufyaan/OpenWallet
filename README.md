# Visa Multilateral Net Settlement on Canton

A Daml model of Visa-style multilateral net settlement, settled atomically in
USDC on the [Canton Network](https://docs.canton.network/appdev/get-started/choose-your-path).

After clearing, every participant bank ends a settlement cycle with a single
**net position** against Visa Treasury — it either pays Visa (net debtor) or is
paid by Visa (net creditor). This project models those positions as bilateral
Daml contracts and settles the entire cycle in **one atomic transaction**,
while Canton's sub-transaction privacy keeps every bank's position invisible
to the other banks.

## Parties

| Party          | Role                                                      |
|----------------|-----------------------------------------------------------|
| `VisaTreasury` | Settlement agent; counterparty to every net position      |
| `IssuerA`      | Card-issuing bank — net debtor in the example cycle       |
| `IssuerB`      | Card-issuing bank — net creditor                          |
| `AcquirerC`    | Acquiring bank — net creditor                             |
| `Regulator`    | Oversight; sees nothing until explicitly disclosed        |
| `CircleUSDC`   | USDC token issuer (signatory of every holding)            |

## Packages

```
visa-settlement/            the model (templates only)
  Visa.Settlement.Usdc        UsdcHolding: Transfer, Allocate, Merge
  Visa.Settlement.Obligation  ObligationProposal, SettlementObligation, SettlementReceipt
  Visa.Settlement.Batch       SettlementBatch.ExecuteSettlement (the atomic settle)
visa-settlement-tests/      Daml Script tests (separate package, per Canton docs guidance)
```

### `UsdcHolding`

A deliberately simple USDC holding: issuer-signed, owner-controlled,
splittable (`Allocate`) and mergeable (`Merge`). It is a plain template, **not**
an implementation of the [CIP-56 token standard](https://docs.canton.network/appdev/deep-dives/token-standard.md)
`Holding` interfaces — the point here is the settlement workflow, not standard
interop. `Allocate` lets an owner carve out an exact amount and disclose just
that part to a counterparty (Visa Treasury), which is how a net debtor earmarks
funds without surrendering control of them.

### `SettlementObligation`

Created via propose/accept (`ObligationProposal.Accept`), so it carries the
signatures of **both** Visa Treasury and the bank. Because only those two are
stakeholders, Canton never distributes it to any other bank. Key choices:

- `AllocateFunds` (bank) — earmark USDC for a net-debit position
- `DiscloseToRegulator` (Visa) — re-creates the contract with the Regulator as
  observer; the bank's signature on the obligation authorizes the disclosure
- `CollectFromBank` / `PayOutToBank` (Visa) — the two settlement legs, only
  ever invoked from inside the batch

### `SettlementBatch.ExecuteSettlement`

One consuming choice = one Daml transaction = all-or-nothing settlement:

1. validates every obligation belongs to the cycle, every bank is covered
   exactly once, and the batch **nets to zero** (debits = credits);
2. collects the earmarked USDC from every net debtor;
3. merges the collected holdings into a settlement pool;
4. pays every net creditor out of the pool, which is consumed exactly.

Visa Treasury is a pure pass-through: with a zero-net batch it needs no float,
and if any leg fails (a bank spent its earmarked funds, an allocation is
missing, an amount mismatches) the whole transaction rolls back and **no money
moves for anyone**.

## Tests (`dpm test`)

| Script | Proves |
|--------|--------|
| `testInterBankInvisibility` | Each bank sees exactly its own position; `queryContractId` on another bank's obligation or USDC resolves to `None`, even with the contract id in hand. Visa sees all three. |
| `testAtomicSettlement` | IssuerA spends its earmarked USDC out from under the batch → the whole settlement fails: all obligations remain active, zero receipts, every balance untouched. After honest re-allocation the same batch settles all three legs in one transaction, conserving money (Visa ends with 0). |
| `testRegulatorAuditability` | Regulator sees nothing pre-disclosure; after `DiscloseToRegulator` it can audit positions and earmarked funding; disclosure survives settlement into the receipts; `DiscloseReceipt` covers after-the-fact disclosure. |
| `testBatchValidation` | A partial batch (missing a bank) and an unbalanced batch (debits ≠ credits) are both rejected. |

## Build & run

Install [dpm](https://docs.digitalasset.com/build/3.4/dpm/dpm.html) (the Daml
package manager, SDK ≥ 3.5):

```bash
curl https://get.digitalasset.com/install/install.sh | sh
```

Then:

```bash
dpm build --all                  # build both packages
cd visa-settlement-tests
dpm test                         # run the Daml Script test suite
```

All scripts run on the in-memory IDE ledger; no Canton node is required for
the tests.

## Live web UI (real ledger)

`webapp-live/` is a browser UI connected to a **real Canton ledger** through
the JSON Ledger API v2 — every button submits actual Daml commands, and each
party tab shows the participant's active contract set filtered for that party
(so the privacy you see is enforced by Canton, not the UI). To run it:

```bash
# 1. start a Canton sandbox with the DARs and the JSON API enabled
dpm sandbox --json-api-port 7575 \
  --dar visa-settlement/.daml/dist/visa-settlement-1.0.0.dar \
  --dar visa-settlement-tests/.daml/dist/visa-settlement-tests-1.0.0.dar

# 2. serve the UI (proxies /api/* to the JSON API, avoiding CORS)
node server/serve.js   # http://localhost:8080
```

The app allocates the six parties on first load. The scenario buttons walk
through propose/accept, funding, atomic settlement, the double-spend
atomicity demo (a genuine `CONTRACT_NOT_FOUND` rejection from Canton), and
regulator disclosure.

`webapp/` is a static, ledger-free **simulator** of the same model (suitable
for Vercel or any static host), useful when no Canton node is available.

## Production notes

Deliberate simplifications to keep the model readable:

- **Locking**: earmarked holdings stay under the bank's control until
  settlement (the atomicity test exploits exactly this). A production system
  would lock allocated holdings — e.g. via the CIP-56 allocation workflow.
- **Token standard**: real USDC on Canton is reachable through the CIP-56
  `Holding`/`Transfer` interfaces; swapping `UsdcHolding` for standard
  holdings changes the `Usdc` module but not the settlement logic.
- **Netting computation**: net positions arrive here as agreed proposals; a
  fuller model would derive them on-ledger from bilateral clearing records.
