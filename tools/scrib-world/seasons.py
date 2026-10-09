"""SCRIB seasons run from September to June; July/August are outside a season."""
import re

def for_date(value):
    year,month=map(int,value[:7].split('-'))
    if month in (7,8):return ''
    start=year if month>=9 else year-1
    return f'{start%100:02d}-{(start+1)%100:02d}'

def label(value, problem):
    match=re.fullmatch(r'(\d{2}|\d{4})\s*[-–—/]\s*(\d{2}|\d{4})',value.strip())
    if not match:raise problem('Indica la temporada como 26-27 (septiembre a junio).')
    first,last=map(int,match.groups())
    first=2000+first if first<100 else first
    last=2000+last if last<100 else last
    if not 1900<=first<=2098 or last!=first+1:raise problem('La temporada debe abarcar dos años consecutivos.')
    return f'{first%100:02d}-{last%100:02d}'
