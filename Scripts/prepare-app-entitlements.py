#!/usr/bin/env python3
"""Keep Developer ID builds strict; local development uses a pinned scene SDK."""
import plistlib,sys
from pathlib import Path
source,identity,output=sys.argv[1:]
value=plistlib.loads(Path(source).read_bytes())
if identity=='-' or identity=='Mole Local Signing':
 value['com.apple.security.cs.disable-library-validation']=True
Path(output).write_bytes(plistlib.dumps(value))
