import { useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  PROJECT_ACCESS_LABELS,
  PROJECT_ACCESS_TOKENS,
} from '#/lib/workspace-admin'
import type { ProjectAccess, ProjectAccessLevel } from '#/lib/workspace-admin'

export function AdminProjectAccess({
  access,
  isOwner,
  onGrant,
  onRevoke,
}: {
  access: ProjectAccess[]
  isOwner: boolean
  onGrant: (
    projectId: string,
    userId: string,
    level: ProjectAccessLevel,
  ) => void
  onRevoke: (projectId: string, userId: string) => void
}) {
  const [open, setOpen] = useState(false),
    [project, setProject] = useState(''),
    [user, setUser] = useState(''),
    [level, setLevel] = useState<ProjectAccessLevel>('viewer')
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {isOwner && <Button onClick={() => setOpen(true)}>Grant access</Button>}
      </div>
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Access level</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {access.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.projectId}</TableCell>
                <TableCell>{item.userId}</TableCell>
                <TableCell>
                  <Badge className={PROJECT_ACCESS_TOKENS[item.accessLevel]}>
                    {PROJECT_ACCESS_LABELS[item.accessLevel]}
                  </Badge>
                </TableCell>
                <TableCell>{item.grantedByUserId}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isOwner}
                    onClick={() => onRevoke(item.projectId, item.userId)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!access.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No project-specific access grants.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant project access</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="grant-project">Project ID</Label>
              <Input
                id="grant-project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="grant-user">User ID</Label>
              <Input
                id="grant-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="grant-level">Access level</Label>
              <Select
                id="grant-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as ProjectAccessLevel)}
              >
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!project.trim() || !user.trim()}
              onClick={() => {
                onGrant(project.trim(), user.trim(), level)
                setOpen(false)
              }}
            >
              Grant access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
