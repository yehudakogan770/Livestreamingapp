import re
root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
M={
'auth/AccountDialog.tsx':'CircleUserRound','auth/PeopleDialog.tsx':'Users','views/SpeakersDialog.tsx':'Mic','views/DataDialog.tsx':'Sheet',
'views/BrowserCard.tsx':'Globe','views/RunOfShow.tsx':'ListChecks','views/OutputsDialog.tsx':'MonitorUp','views/PresetEditor.tsx':'ListOrdered',
'views/SlideshowEditor.tsx':'Images','views/TriggersDialog.tsx':'Zap','views/OverlayEditor.tsx':'Layers','views/TriviaCard.tsx':'CircleHelp',
'views/GraphicCard.tsx':'PenTool','views/ZmanimDialog.tsx':'CalendarClock','views/PlaylistEditor.tsx':'ListVideo','views/AuctionCard.tsx':'Gavel',
'views/BrandDialog.tsx':'Palette','views/ScriptureCard.tsx':'BookOpen','views/LyricsCard.tsx':'ListMusic','views/GreenScreenDialog.tsx':'Pipette',
'views/CameraDialog.tsx':'Camera','views/MidiDialog.tsx':'Piano','views/SeatingCard.tsx':'Table2','views/InputSettings.tsx':'SlidersHorizontal',
'views/LogoMaker.tsx':'Box','views/RemoteDialog.tsx':'Smartphone','views/ScoreCard.tsx':'Trophy','views/SplitEditor.tsx':'Grid2x2',
'views/LibraryDialog.tsx':'LibraryBig','views/AddInput.tsx':'SquarePlus','views/PesukimEditor.tsx':'Scroll','views/ScreenCard.tsx':'ScreenShare',
'views/SoundOutputsDialog.tsx':'Speaker','views/PtzCard.tsx':'Move','views/GuestCard.tsx':'UserRound','views/ShortcutsDialog.tsx':'Keyboard',
'views/StreamCard.tsx':'Video','views/CreditsCard.tsx':'Clapperboard','views/PollCard.tsx':'ChartColumn','views/HelpDialog.tsx':'BookOpen',
'views/TextEditor.tsx':'Type','views/StingerDialog.tsx':'Film','views/EventSetup.tsx':'CalendarCog','views/CloseConfirm.tsx':'Power',
'views/CountdownDialog.tsx':'Timer','captions/CaptionsDialog.tsx':'Captions','broadcast/BroadcastDialog.tsx':'Radio',
'views/AudienceCards.tsx':None,
}
AUD={'Raffle':'Ticket','Fundraiser':'HandCoins','Messages wall':'MessagesSquare'}

def add_import(s, names):
    m = re.search(r"import \{([^}]*)\} from 'lucide-react';", s)
    if m:
        have=[x.strip() for x in m.group(1).split(',') if x.strip()]
        allx=sorted(set(have)|set(names), key=lambda x:(x.startswith('type '), x.lower()))
        return s[:m.start()]+"import { "+', '.join(allx)+" } from 'lucide-react';"+s[m.end():]
    i=s.index('import ')
    return s[:i]+"import { "+', '.join(sorted(names))+" } from 'lucide-react';\n"+s[i:]

for f,icon in M.items():
    p=root+f
    s=open(p).read()
    lines=s.split('\n')
    used=set()
    for i,l in enumerate(lines):
        if 'className="modal__head"' in l and i+1<len(lines) and lines[i+1].strip().startswith('<h2>'):
            ic=icon
            if ic is None:
                ic=next(v for k,v in AUD.items() if k in lines[i+1])
            lines[i+1]=lines[i+1].replace('<h2>','<h2>\n<'+ic+' className="modal__icon" aria-hidden="true" />',1)
            used.add(ic)
    if not used:
        print('no head', f); continue
    s='\n'.join(lines)
    s=add_import(s,list(used))
    open(p,'w').write(s)
print('done')
