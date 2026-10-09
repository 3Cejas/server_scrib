#!/usr/bin/env python3
"""Add one bounded authenticated upload route, preserving other Nginx routes."""
import argparse
from pathlib import Path
import rename_world

BEGIN='# BEGIN SCRIB DOCUMENT PROVENANCE\n'
END='# END SCRIB DOCUMENT PROVENANCE\n'
ROUTE='= /scrib/backstage/api/pdf/verify'


def transform(source, gateway=False):
    canonical=rename_world.GATEWAY_NGINX if gateway else rename_world.NGINX
    location=rename_world.gateway_location if gateway else rename_world.private_location
    block=BEGIN+location(ROUTE).replace('{\n','{\n    client_max_body_size 23m;\n',1)+END
    if source.count(block)==1:
        if source.count(BEGIN)!=1 or source.count(canonical)!=1:
            raise ValueError('Rutas duplicadas o modificadas; revisar antes de publicar.')
        return source
    if BEGIN in source or ROUTE in source or source.count(canonical)!=1:
        raise ValueError('Rutas instaladas modificadas; revisar antes de publicar.')
    return source.replace(canonical,canonical+block,1)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('kind',choices=['nginx','gateway-nginx'])
    parser.add_argument('source',type=Path);parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    args.destination.write_text(transform(args.source.read_text(),args.kind=='gateway-nginx'))


if __name__=='__main__':main()
