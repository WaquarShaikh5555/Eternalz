# CSV Join by Date Proximity

When two CSV files don't share a common key (like Bill Number vs Year Sequence), join them by matching dates within a tolerance window.

## Pattern

Build entries with parsed dates, then join by nearest date within a 90-day window. Fall back to sequential pairing if no date matches found. Preserve orphan records (bills without values or vice versa) with null fields. Sort descending (newest first) for timeline display.

## Key Points

- 90-day window works well for property tax data (bills process months after assessments)
- Sequential fallback ensures records still pair
- Orphan records preserved with null fields
- Sort by date descending (newest first) after joining
- Bill Numbers (e.g. `2250100`) and Year Sequences (e.g. `2025010`) are DIFFERENT numbering systems — no direct key match exists

## Real-World Example

LA County property tax data: Values CSV has `Bill Number` (e.g. `2250100`), Bills CSV has `Year Sequence` (e.g. `2025010`). These are completely different numbering systems with no common key. Date-based join using `Recording Date` (Values) ↔ `Process Date` (Bills) matches them correctly.

## JavaScript Implementation

```javascript
var joined=[],usedBills=new Set;
values.forEach(function(v){
  var vd=v.date,bb=null,bd=Infinity;
  bills.forEach(function(b,i){
    if(usedBills.has(i))return;
    var bdd=b.procDate||b.billDate;
    if(!bdd||bdd.getTime()===0)return;
    var d=Math.abs(vd-bdd);
    d<bd&&d<90*86400000&&(bd=d,bb={bill:b,idx:i});
  });
  if(bb){usedBills.add(bb.idx);joined.push({value:v,bill:bb.bill})}
  else joined.push({value:v,bill:null});
});
// Add orphan bills
bills.forEach(function(b,i){usedBills.has(i)||joined.push({value:null,bill:b})});
// Fallback: sequential pairing
if(joined.filter(function(j){return j.bill!==null}).length===0&&values.length>0&&bills.length>0){
  joined.length=0;
  var mx=Math.max(values.length,bills.length);
  for(var i=0;i<mx;i++)joined.push({value:values[i]||null,bill:bills[i]||null});
}
// Sort newest first
joined.sort(function(a,b){
  var da=a.value?a.value.date:a.bill.procDate||a.bill.billDate||new Date(0),
      db=b.value?b.value.date:b.bill.procDate||b.bill.billDate||new Date(0);
  return db-da;
});
```
