import os, json, datetime, tarfile
R=[os.path.expanduser("~"),"/var/lib","/var/backups","/opt","/srv"]
def z(ms):
    try: return datetime.datetime.fromtimestamp(ms/1000).strftime("%d.%m. %H:%M")
    except: return "?"
tr,tb=[],[]
for r in R:
    if not os.path.isdir(r): continue
    b=r.rstrip("/").count(os.sep)
    for dp,ds,fs in os.walk(r,onerror=lambda e:None):
        if dp.count(os.sep)-b>8: ds[:]=[]; continue
        ds[:]=[d for d in ds if d not in(".git","node_modules",".cache",".npm")]
        for f in fs:
            p=os.path.join(dp,f)
            if f in("state.json","state.json.bak","users.json") or (f.startswith("game-") and f.endswith(".json")): tr.append(p)
            elif f.startswith("handball-data_") and f.endswith(".tar.gz"): tb.append(p)
print("="*70,"\nSPIELSTAENDE UND ARCHIVE\n","="*70)
for p in sorted(set(tr)) or ["  nichts gefunden"]:
    if not os.path.exists(p): print(p); continue
    s=os.stat(p); print("\n%s %8dB  %s"%(datetime.datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M"),s.st_size,p))
    try: d=json.load(open(p,encoding="utf-8"))
    except Exception as e: print("     !! %s"%e); continue
    if os.path.basename(p)=="users.json":
        print("     Benutzer: "+", ".join(x.get("username","?") for x in d)); continue
    sp=d.get("spieler") or []; ak=d.get("aktionen") or []
    ts=[a.get("timestamp") for a in ak if isinstance(a.get("timestamp"),(int,float))]
    l="     %d Spieler, %d Aktionen, Heim=%r Gast=%r"%(len(sp),len(ak),d.get("teamHeim"),d.get("teamGast"))
    if ts: l+=", %s bis %s"%(z(min(ts)),z(max(ts)))
    if d.get("archivedAt"): l+=", archiviert "+d["archivedAt"][:16].replace("T"," ")
    print(l)
    if sp: print("     "+", ".join("#%s %s"%(x.get("nummer"),x.get("name")) for x in sp[:10]))
print("\n"+"="*70,"\nBACKUPS\n","="*70)
for p in sorted(set(tb)) or ["  keine gefunden"]:
    if not os.path.exists(p): print(p); continue
    s=os.stat(p); print("\n%s %8dB  %s"%(datetime.datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M"),s.st_size,p))
    try:
        with tarfile.open(p) as t: n=[m.name for m in t.getmembers() if m.name.endswith(".json")]
        for x in n[:12]: print("     "+x)
    except Exception as e: print("     !! %s"%e)
