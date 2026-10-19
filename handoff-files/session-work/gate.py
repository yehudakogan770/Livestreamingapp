root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
p=root+'auth/Gate.tsx'
s=open(p).read()
old='''    <div className="gate">
      <div className="gate__card">
        <div className="gate__brand">
          <img src="./brand/lumora-logo.svg" alt="Lumora" />
        </div>'''
new='''    <div className="gate">
      <div className="gate__card">
        <aside className="gate__side" aria-hidden="true">
          <img src="./brand/lumora-logo.svg" alt="" />
          <span className="gate__tag">Live production</span>
          <span className="gate__rule">
            <i />
            <i />
            <i />
          </span>
        </aside>
        <div className="gate__main">
        <div className="gate__brand">
          <img src="./brand/lumora-logo.svg" alt="Lumora" />
        </div>'''
assert old in s
s=s.replace(old,new)
old2='''            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignIn() {'''
new2='''            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function SignIn() {'''
assert old2 in s
s=s.replace(old2,new2)
open(p,'w').write(s)
