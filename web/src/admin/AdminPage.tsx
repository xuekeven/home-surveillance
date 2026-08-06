import type { FormEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Radio,
  Space,
  Switch,
  Table,
  theme,
  Tooltip,
  Typography,
  Upload
} from 'antd'
import type { TableColumnsType, UploadFile } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import * as faceapi from 'face-api.js'
import { ensureFaceApiModels } from '../shared/faceApiModels'
import { absoluteRoomEntryUrls } from '../config'
import {
  adminAddFamilyMember,
  adminDeleteFamilyMember,
  adminDeleteRoom,
  adminFetchFamily,
  adminFetchRooms,
  adminPatchRoom,
  adminUpdateFamilyMember
} from '../shared/familyMembersApi'
import type { StoredFamilyMember } from '../shared/familyMemberTypes'

const SESSION_KEY = 'hs-admin-token'

/** 后台表格 / 弹窗：浅色 + 主色苔绿，与全局 CSS 变量一致 */
const ADMIN_ANTD_THEME = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#4d9e8b',
    colorLink: '#2f8676',
    colorText: '#2c3f36',
    colorTextSecondary: '#6b8078',
    colorBorder: 'rgba(58, 110, 95, 0.14)',
    colorBorderSecondary: 'rgba(58, 110, 95, 0.1)',
    borderRadiusLG: 12
  },
  components: {
    Table: {
      headerBg: '#eef6f2',
      headerColor: '#33483f',
      rowHoverBg: '#f4faf8',
      borderColor: 'rgba(58, 110, 95, 0.12)'
    }
  }
}

type FamilyTableRow = {
  key: string
  memberId: string
  label: string
  photoDataUrl?: string
}

async function imageFileToJpegDataUrl(file: File, maxSide = 360, quality = 0.85): Promise<string> {
  const img = await faceapi.bufferToImage(file)
  const canvas = document.createElement('canvas')
  let w = img.width
  let h = img.height
  const scale = Math.min(1, maxSide / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale))
  h = Math.max(1, Math.round(h * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建画布')
  }
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function validateRoomIdEnglish(_: unknown, value: unknown): Promise<void> {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) {
    return Promise.resolve()
  }
  if (v.length > 50) {
    return Promise.reject(new Error('长度不能超过 50'))
  }
  if (!/^[a-zA-Z]+$/.test(v)) {
    return Promise.reject(new Error('仅限英文字母（A–Z、a–z）'))
  }
  return Promise.resolve()
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.left = '-10000px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function UrlWithCopy({ url }: { url: string }) {
  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(url)
    if (ok) {
      message.success('已复制到剪贴板')
    } else {
      message.error('复制失败')
    }
  }, [url])

  return (
    <div className="admin-url-cell">
      <div className="admin-url-cell-row">
        <Tooltip title={url} >
          <span className="admin-url-cell-text-wrap">
            <a href={url} target="_blank" rel="noopener noreferrer" className="admin-url-cell-anchor">
              {url}
            </a>
          </span>
        </Tooltip>
        <span className="admin-url-copy-slot">
          <Tooltip title="复制链接">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              className="admin-url-copy-btn"
              onClick={() => void onCopy()}
              aria-label="复制链接"
            />
          </Tooltip>
        </span>
      </div>
    </div>
  )
}

function AdminFamilySection({ adminToken }: { adminToken: string }) {
  const [members, setMembers] = useState<StoredFamilyMember[]>([])
  const [familyModalOpen, setFamilyModalOpen] = useState(false)
  const [familySubmitting, setFamilySubmitting] = useState(false)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const [photoPreviewSrc, setPhotoPreviewSrc] = useState('')
  const photoPreviewRevokeRef = useRef<(() => void) | null>(null)
  const [familyForm] = Form.useForm<{ title: string; photo: UploadFile[] }>()

  const closePhotoPreview = useCallback(() => {
    photoPreviewRevokeRef.current?.()
    photoPreviewRevokeRef.current = null
    setPhotoPreviewOpen(false)
    setPhotoPreviewSrc('')
  }, [])

  const handlePhotoPreview = useCallback((file: UploadFile) => {
    photoPreviewRevokeRef.current?.()
    photoPreviewRevokeRef.current = null

    let src = typeof file.url === 'string' ? file.url : typeof file.thumbUrl === 'string' ? file.thumbUrl : undefined
    if (!src && file.originFileObj) {
      src = URL.createObjectURL(file.originFileObj)
      photoPreviewRevokeRef.current = () => URL.revokeObjectURL(src!)
    }
    if (!src) {
      return
    }
    setPhotoPreviewSrc(src)
    setPhotoPreviewOpen(true)
  }, [])

  useEffect(() => {
    return () => {
      photoPreviewRevokeRef.current?.()
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const list = await adminFetchFamily(adminToken)
      setMembers(list)
    } catch {
      setMembers([])
    }
  }, [adminToken])

  useEffect(() => {
    void reload()
  }, [reload])

  function openAddFamilyModal() {
    setEditingMemberId(null)
    familyForm.resetFields()
    setFamilyModalOpen(true)
  }

  function openEditFamilyModal(m: StoredFamilyMember) {
    setEditingMemberId(m.id)
    familyForm.setFieldsValue({
      title: m.label,
      photo: m.photoDataUrl
        ? [
            {
              uid: '-1',
              name: 'photo',
              status: 'done',
              url: m.photoDataUrl
            }
          ]
        : []
    })
    setFamilyModalOpen(true)
  }

  function closeFamilyModal() {
    closePhotoPreview()
    setFamilyModalOpen(false)
    setEditingMemberId(null)
    familyForm.resetFields()
  }

  async function submitFamilyModal() {
    let values: { title: string; photo: UploadFile[] }
    try {
      values = await familyForm.validateFields()
    } catch (e: unknown) {
      if (isFormValidateFailed(e)) {
        return
      }
      throw e
    }

    const label = values.title.trim()
    const fileList = values.photo
    const first = fileList[0]
    const rawFile = first?.originFileObj as File | undefined

    setFamilySubmitting(true)
    try {
      await ensureFaceApiModels()

      let descriptor: number[]
      let photoDataUrl: string

      if (rawFile) {
        const img = await faceapi.bufferToImage(rawFile)
        const det = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor()
        if (!det) {
          message.warning('未检测到清晰人脸，请换一张照片')
          return
        }
        descriptor = Array.from(det.descriptor)
        photoDataUrl = await imageFileToJpegDataUrl(rawFile)
      } else if (editingMemberId) {
        const prev = members.find((x) => x.id === editingMemberId)
        const keptUrl = typeof first?.url === 'string' ? first.url : undefined
        if (!prev || !keptUrl?.startsWith('data:image/')) {
          message.warning('请上传照片')
          return
        }
        descriptor = prev.descriptor
        photoDataUrl = keptUrl
      } else {
        message.warning('请上传照片')
        return
      }

      if (editingMemberId) {
        const prev = members.find((x) => x.id === editingMemberId)
        if (!prev) {
          message.error('记录已失效，请刷新页面')
          return
        }
        const patch: { label?: string; descriptor?: number[]; photoDataUrl?: string } = {}
        if (label !== prev.label) {
          patch.label = label
        }
        if (rawFile) {
          patch.descriptor = descriptor
          patch.photoDataUrl = photoDataUrl
        }
        if (patch.label === undefined && patch.descriptor === undefined) {
          message.success('未修改')
          closeFamilyModal()
          return
        }
        await adminUpdateFamilyMember(adminToken, editingMemberId, patch)
        message.success('已更新')
      } else {
        await adminAddFamilyMember(adminToken, { label, descriptor, photoDataUrl })
        message.success('已保存到服务器。采集端/观看端将在轮询周期内同步。')
      }

      await reload()
      closeFamilyModal()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setFamilySubmitting(false)
    }
  }

  function confirmRemoveMember(memberId: string, label: string) {
    Modal.confirm({
      title: '删除家庭成员',
      icon: null,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <span>
          是否删除 <strong style={{ color: '#2c3f36', fontWeight: 700 }}>{label}</strong> 成员？
        </span>
      ),
      onOk: async () => {
        try {
          await adminDeleteFamilyMember(adminToken, memberId)
          await reload()
          message.success('已删除')
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败')
          return Promise.reject(e)
        }
      }
    })
  }

  const familyRows: FamilyTableRow[] = members
    .map((m) => ({
      key: m.id,
      memberId: m.id,
      label: m.label,
      photoDataUrl: m.photoDataUrl
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const familyColumns: TableColumnsType<FamilyTableRow> = [
    {
      title: '称呼',
      dataIndex: 'label',
      width: '28%',
      render: (text: string) => (
        <span className="admin-room-id-wrap">
          <Tooltip title={text}>
            <Typography.Text>{text}</Typography.Text>
          </Tooltip>
        </span>
      )
    },
    {
      title: '照片',
      dataIndex: 'photoDataUrl',
      width: '52%',
      render: (_: unknown, record) =>
        record.photoDataUrl ? (
          <img src={record.photoDataUrl} alt="" className="admin-family-photo-thumb" />
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      title: '操作',
      key: 'actions',
      width: '20%',
      render: (_: unknown, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => {
              const m = members.find((x) => x.id === record.memberId)
              if (m) {
                openEditFamilyModal(m)
              }
            }}
          >
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => confirmRemoveMember(record.memberId, record.label)}>
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <ConfigProvider theme={ADMIN_ANTD_THEME}>
      <div className="family-face-panel admin-panel-block">
        <h2 className="family-face-heading">家庭成员</h2>
        <p className="muted family-face-desc">
          添加家庭成员后，不会认为是「陌生人」。
        </p>
        <div className="admin-section-toolbar">
          <button type="button" className="secondary" disabled={familySubmitting} onClick={openAddFamilyModal}>
            上传成员照片
          </button>
        </div>
        {familyRows.length > 0 ? (
          <div className="admin-room-table-shell">
            <Table<FamilyTableRow>
              className="admin-room-table"
              size="small"
              pagination={false}
              columns={familyColumns}
              dataSource={familyRows}
              tableLayout="fixed"
            />
          </div>
        ) : null}

        <Modal
          title={editingMemberId ? '编辑家庭成员' : '上传家庭成员照片'}
          open={familyModalOpen}
          okText="确定"
          cancelText="取消"
          confirmLoading={familySubmitting}
          destroyOnClose
          onCancel={closeFamilyModal}
          onOk={() => void submitFamilyModal()}
          afterClose={() => familyForm.resetFields()}
        >
          <Form form={familyForm} layout="vertical" preserve={false}>
            <Form.Item
              name="title"
              label="称呼"
              rules={[{ required: true, whitespace: true, message: '请输入称呼' }]}
            >
              <Input maxLength={120} placeholder="请输入" autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="photo"
              label="照片"
              valuePropName="fileList"
              getValueFromEvent={(e) => (Array.isArray(e) ? e : (e?.fileList ?? []))}
              rules={[{ required: true, message: '请上传照片' }]}
            >
              <Upload
                accept="image/*"
                maxCount={1}
                listType="picture-card"
                beforeUpload={() => false}
                onPreview={handlePhotoPreview}
              >
                <div style={{ marginTop: 8 }}>上传</div>
              </Upload>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="照片预览"
          open={photoPreviewOpen}
          footer={null}
          width={560}
          destroyOnClose
          onCancel={closePhotoPreview}
          styles={{ body: { paddingTop: 12, textAlign: 'center' } }}
        >
          {photoPreviewSrc ? (
            <img
              src={photoPreviewSrc}
              alt="预览"
              style={{ maxWidth: '100%', maxHeight: 'min(70vh, 520px)', objectFit: 'contain', verticalAlign: 'middle' }}
            />
          ) : null}
        </Modal>
      </div>
    </ConfigProvider>
  )
}

function isFormValidateFailed(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'errorFields' in e &&
    Array.isArray((e as { errorFields: unknown }).errorFields)
  )
}

type RoomTableRow = {
  key: string
  roomId: string
  publicCameraUrl: string
  internalCameraUrl: string
  publicViewerUrl: string
  internalViewerUrl: string
  enabled: boolean
  strangerFaceAlert: boolean
  maxViewersPerRoom: number
}

function AdminRoomsSection({ adminToken }: { adminToken: string }) {
  const [addForm] = Form.useForm<{
    roomId: string
    allowConnect: boolean
    strangerFaceAlert: boolean
    maxViewersPerRoom: number
  }>()
  const [editForm] = Form.useForm<{
    allowConnect: boolean
    strangerFaceAlert: boolean
    maxViewersPerRoom: number
  }>()
  const [rooms, setRooms] = useState<
    Record<string, { enabled: boolean; strangerFaceAlert: boolean; maxViewersPerRoom: number }>
  >({})
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const reload = useCallback(async () => {
    try {
      const r = await adminFetchRooms(adminToken)
      setRooms(r)
    } catch {
      setRooms({})
    }
  }, [adminToken])

  useEffect(() => {
    void reload()
  }, [reload])

  const patchRoomEnabled = useCallback(
    async (roomId: string, enabled: boolean) => {
      try {
        await adminPatchRoom(adminToken, roomId, { enabled })
        await reload()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '保存失败')
      }
    },
    [adminToken, reload]
  )

  const patchRoomStrangerAlert = useCallback(
    async (roomId: string, strangerFaceAlert: boolean) => {
      try {
        await adminPatchRoom(adminToken, roomId, { strangerFaceAlert })
        await reload()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '保存失败')
      }
    },
    [adminToken, reload]
  )

  async function submitAddRoomModal() {
    try {
      const values = await addForm.validateFields()
      const id = values.roomId.trim()
      setAddSubmitting(true)
      await adminPatchRoom(adminToken, id, {
        enabled: values.allowConnect,
        strangerFaceAlert: values.strangerFaceAlert,
        maxViewersPerRoom: values.maxViewersPerRoom
      })
      await reload()
      message.success(`已写入房间「${id}」策略。`)
      setAddModalOpen(false)
      addForm.resetFields()
    } catch (e: unknown) {
      if (isFormValidateFailed(e)) {
        return
      }
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setAddSubmitting(false)
    }
  }

  function openEdit(record: RoomTableRow) {
    setEditingRoomId(record.roomId)
    editForm.setFieldsValue({
      allowConnect: record.enabled,
      strangerFaceAlert: record.strangerFaceAlert,
      maxViewersPerRoom: record.maxViewersPerRoom
    })
    setEditModalOpen(true)
  }

  async function submitEditRoomModal() {
    if (!editingRoomId) {
      return
    }
    try {
      const values = await editForm.validateFields()
      setEditSubmitting(true)
      await adminPatchRoom(adminToken, editingRoomId, {
        enabled: values.allowConnect,
        strangerFaceAlert: values.strangerFaceAlert,
        maxViewersPerRoom: values.maxViewersPerRoom
      })
      await reload()
      message.success(`已更新房间「${editingRoomId}」。`)
      setEditModalOpen(false)
      setEditingRoomId(null)
      editForm.resetFields()
    } catch (e: unknown) {
      if (isFormValidateFailed(e)) {
        return
      }
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setEditSubmitting(false)
    }
  }

  function confirmDeleteRoom(roomId: string) {
    Modal.confirm({
      title: '删除房间',
      icon: null,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <span>
          是否删除 <strong style={{ color: '#2c3f36', fontWeight: 700 }}>{roomId}</strong> 房间？
        </span>
      ),
      onOk: async () => {
        try {
          await adminDeleteRoom(adminToken, roomId)
          await reload()
          message.success('已删除房间')
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败')
          return Promise.reject(e)
        }
      }
    })
  }

  const dataSource: RoomTableRow[] = Object.entries(rooms)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([roomId, policy]) => {
      const urls = absoluteRoomEntryUrls(roomId)
      return {
        key: roomId,
        roomId,
        publicCameraUrl: urls.publicCamera,
        internalCameraUrl: urls.internalCamera,
        publicViewerUrl: urls.publicViewer,
        internalViewerUrl: urls.internalViewer,
        enabled: policy.enabled === true,
        strangerFaceAlert: policy.strangerFaceAlert === true,
        maxViewersPerRoom:
          typeof policy.maxViewersPerRoom === 'number' && Number.isFinite(policy.maxViewersPerRoom)
            ? policy.maxViewersPerRoom
            : 2
      }
    })

  const columns: TableColumnsType<RoomTableRow> = [
    {
      title: '房间 ID',
      dataIndex: 'roomId',
      width: 90,
      render: (id: string) => (
        <span className="admin-room-id-wrap">
          <Tooltip title={id}>
            <Typography.Text>{id}</Typography.Text>
          </Tooltip>
        </span>
      )
    },
    {
      title: '公网采集端',
      dataIndex: 'publicCameraUrl',
      width: 175,
      render: (url: string) => <UrlWithCopy url={url} />
    },
    {
      title: '内网采集端',
      dataIndex: 'internalCameraUrl',
      width: 175,
      render: (url: string) => <UrlWithCopy url={url} />
    },
    {
      title: '公网查看端',
      dataIndex: 'publicViewerUrl',
      width: 175,
      render: (url: string) => <UrlWithCopy url={url} />
    },
    {
      title: '内网查看端',
      dataIndex: 'internalViewerUrl',
      width: 175,
      render: (url: string) => <UrlWithCopy url={url} />
    },
    {
      title: '是否启用房间',
      dataIndex: 'enabled',
      width: 120,
      render: (_: boolean, record) => (
        <Switch checked={record.enabled} onChange={(checked) => void patchRoomEnabled(record.roomId, checked)} />
      )
    },
    {
      title: (
        <Tooltip title="该房间允许同时在线的观看端数量（不含采集端），超出则无法再加入。">
          <span>最多查看端</span>
        </Tooltip>
      ),
      dataIndex: 'maxViewersPerRoom',
      width: 100,
      render: (n: number) => <Typography.Text>{n}</Typography.Text>
    },
    {
      title: (
        <Tooltip title="开启后：采集端在该房间才会运行人脸检测、抓拍并在配置企微中转时可上报告警；关闭则采集端仅采集与 WebRTC。观看端仍只受本页「陌生人检测」控制，与此项无关。">
          <span>陌生人抓拍和警告</span>
        </Tooltip>
      ),
      dataIndex: 'strangerFaceAlert',
      width: 160,
      render: (_: boolean, record) => (
        <Switch
          checked={record.strangerFaceAlert}
          onChange={(checked) => void patchRoomStrangerAlert(record.roomId, checked)}
        />
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => confirmDeleteRoom(record.roomId)}>
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <ConfigProvider theme={ADMIN_ANTD_THEME}>
      <div className="family-face-panel admin-panel-block">
        <h2 className="family-face-heading">房间管理</h2>
        <p className="muted family-face-desc">
          「是否启用房间」设为「是」的房间，采集端与观看端才能信令加入；未添加的房间一律视为未启用。
          <br />
          「最多查看端」为同时允许的观看端数量。
          <br />
          「陌生人抓拍和警告」按房间配置：开启后采集端在该房间才会运行人脸抓拍与告警；观看端仍仅在本页「陌生人检测」打开且远端有画面时做人脸推理。
        </p>

        <div className="admin-section-toolbar">
          <button type="button" className="secondary" onClick={() => setAddModalOpen(true)}>
            添加房间
          </button>
        </div>

        {dataSource.length > 0 ? (
          <div className="admin-room-table-shell">
            <Table<RoomTableRow>
              className="admin-room-table"
              size="small"
              pagination={false}
              columns={columns}
              dataSource={dataSource}
              tableLayout="fixed"
              scroll={{ x: 1270 }}
            />
          </div>
        ) : null}

        <Modal
          title="添加房间"
          open={addModalOpen}
          okText="确定"
          cancelText="取消"
          confirmLoading={addSubmitting}
          destroyOnClose
          afterClose={() => addForm.resetFields()}
          onCancel={() => setAddModalOpen(false)}
          onOk={() => void submitAddRoomModal()}
        >
          <Form
            form={addForm}
            layout="vertical"
            initialValues={{
              allowConnect: true,
              strangerFaceAlert: false,
              maxViewersPerRoom: 2
            }}
            preserve={false}
          >
            <Form.Item
              name="roomId"
              label="房间 ID"
              rules={[
                { required: true, whitespace: true, message: '请输入房间 ID' },
                { validator: validateRoomIdEnglish }
              ]}
            >
              <Input maxLength={50} placeholder="请输入" autoComplete="off" />
            </Form.Item>
            <Form.Item name="allowConnect" label="是否启用房间">
              <Radio.Group>
                <Radio value={true}>是</Radio>
                <Radio value={false}>否</Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item
              name="maxViewersPerRoom"
              label="最多查看端"
              rules={[
                {
                  validator: (_, value) => {
                    const n = value === null || value === undefined ? NaN : Number(value)
                    if (!Number.isInteger(n) || n < 1 || n > 99) {
                      return Promise.reject(new Error('请输入 1～99 的整数'))
                    }
                    return Promise.resolve()
                  }
                }
              ]}
            >
              <InputNumber min={1} max={99} precision={0} style={{ width: '100%' }} placeholder="不含采集端" />
            </Form.Item>
            <Form.Item name="strangerFaceAlert" label="陌生人抓拍和警告">
              <Radio.Group>
                <Radio value={true}>开启</Radio>
                <Radio value={false}>关闭</Radio>
              </Radio.Group>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="编辑房间"
          open={editModalOpen}
          okText="确定"
          cancelText="取消"
          confirmLoading={editSubmitting}
          destroyOnClose
          afterClose={() => {
            editForm.resetFields()
            setEditingRoomId(null)
          }}
          onCancel={() => setEditModalOpen(false)}
          onOk={() => void submitEditRoomModal()}
        >
          {editingRoomId ? (
            <Form form={editForm} layout="vertical" preserve={false}>
              <Form.Item label="房间 ID">
                <Input value={editingRoomId} disabled />
              </Form.Item>
              <Form.Item name="allowConnect" label="是否启用房间">
                <Radio.Group>
                  <Radio value={true}>是</Radio>
                  <Radio value={false}>否</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                name="maxViewersPerRoom"
                label="最多查看端"
                rules={[
                  {
                    validator: (_, value) => {
                      const n = value === null || value === undefined ? NaN : Number(value)
                      if (!Number.isInteger(n) || n < 1 || n > 99) {
                        return Promise.reject(new Error('请输入 1～99 的整数'))
                      }
                      return Promise.resolve()
                    }
                  }
                ]}
              >
                <InputNumber min={1} max={99} precision={0} style={{ width: '100%' }} placeholder="不含采集端" />
              </Form.Item>
              <Form.Item name="strangerFaceAlert" label="陌生人抓拍和警告">
                <Radio.Group>
                  <Radio value={true}>开启</Radio>
                  <Radio value={false}>关闭</Radio>
                </Radio.Group>
              </Form.Item>
            </Form>
          ) : null}
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export function AdminPage() {
  const [tokenInput, setTokenInput] = useState('')
  const [token, setToken] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginPending, setLoginPending] = useState(false)

  const validateAndStoreToken = useCallback(async (next: string) => {
    await adminFetchRooms(next)
    sessionStorage.setItem(SESSION_KEY, next)
    setToken(next)
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)?.trim()
    if (!saved) {
      return
    }

    let cancelled = false
    setLoginPending(true)
    void validateAndStoreToken(saved)
      .catch((error: unknown) => {
        if (!cancelled) {
          sessionStorage.removeItem(SESSION_KEY)
          setLoginError(error instanceof Error ? error.message : '管理员密钥验证失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoginPending(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [validateAndStoreToken])

  async function login(event: FormEvent) {
    event.preventDefault()
    const next = tokenInput.trim()
    if (!next || loginPending) {
      return
    }

    setLoginError('')
    setLoginPending(true)
    try {
      await validateAndStoreToken(next)
      setTokenInput('')
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY)
      setLoginError(error instanceof Error ? error.message : '管理员密钥验证失败')
    } finally {
      setLoginPending(false)
    }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setToken('')
    setTokenInput('')
  }

  if (!token) {
    return (
      <main className="page">
        <section className="panel admin-login-panel">
          <div className="eyebrow">管理后台</div>
          <h1>后台管理</h1>
          <form className="admin-login-form" onSubmit={login}>
            <input
              type="password"
              autoComplete="off"
              placeholder="管理员密钥"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              className="admin-login-input"
              disabled={loginPending}
            />
            <button type="submit" disabled={loginPending || !tokenInput.trim()}>
              {loginPending ? '验证中…' : '登录'}
            </button>
            {loginError ? <div className="alert">{loginError}</div> : null}
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <section className="panel admin-dashboard">
        <div className="admin-dashboard-head">
          <div>
            <div className="eyebrow">管理后台</div>
            <h1>后台管理</h1>
          </div>
          <button type="button" className="secondary" onClick={logout}>
            退出登录
          </button>
        </div>
        <AdminRoomsSection adminToken={token} />
        <AdminFamilySection adminToken={token} />
      </section>
    </main>
  )
}
