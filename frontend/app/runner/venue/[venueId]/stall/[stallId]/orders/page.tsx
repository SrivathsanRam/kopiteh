"use client";

import { api } from "@/lib/api";
import { BackButton } from "@/components/ui/BackButton";
import { AddOrderPanel } from "@/components/ui/runner/addorderpanel";
import { OrderItemDetails } from "@/components/ui/runner/OrderItemDetails";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { OrderItem, OrderItemStatus  } from "../../../../../../../../types/order";
import { Stall } from "../../../../../../../../types/stall";
import { MenuItem } from "../../../../../../../../types/item";
import { useWebSocket } from "@/context/WebSocketContext";

export default function Home() {
  const params = useParams();
  const venueId = Array.isArray(params.venueId) ? params.venueId[0] : params.venueId;
  const stallId = Array.isArray(params.stallId) ? params.stallId[0] : params.stallId;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket, isConnected, joinStall, leaveStall } = useWebSocket();

  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [stall, setStall] = useState<Stall | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<OrderItemStatus>("INCOMING");
  const [newIncomingIds, setNewIncomingIds] = useState<Set<number>>(new Set());
  const previousStatusRef = useRef<OrderItemStatus>("INCOMING");
  const orderItemIdsRef = useRef<Set<number>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);

  const [showAddOrder, setShowAddOrder] = useState(false);
  const [showOrderItemDetails, setShowOrderItemDetails] = useState(false);
  const [selectedOrderItem, setSelectedOrderItem] = useState<OrderItem | null>(null);
  
  // Swipe state
  const [swipeState, setSwipeState] = useState<{ [key: number]: { x: number; startX: number; isSwiping: boolean } }>({});
  const [updatingItemIds, setUpdatingItemIds] = useState<Set<number>>(new Set());

  const [showItems, setShowItems] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [togglingItemIds, setTogglingItemIds] = useState<Set<number>>(new Set());
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const filteredOrderItems = orderItems.filter(
    (item) => item.status === selectedStatus
  );

  // -- FETCHING STALL AND ORDER ITEMS --
  const getStall = useCallback(async () => {
    try{
      const response = await api.getStallById(Number(stallId));

      if (!response) {
        throw new Error("Failed to fetch stall");
      }
      setStall(response);
    } catch (error: any) {
      setError(error.message);
    }
  }, [stallId]);

  const getOrderItemsByStall = useCallback(async () => {
    try {
      const response = await api.getOrderItemsByStall(Number(stallId));

      if (!response) {
        throw new Error("Failed to fetch order items");
      }
      console.log("Fetched order items:", response);
      setOrderItems(response);
      orderItemIdsRef.current = new Set(response.map((item) => Number(item.order_item_id)));
    } catch (error: any) {
      setError(error.message);
    }
  }, [stallId]);

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === "undefined") return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current.state === "running" ? audioContextRef.current : null;
  }, []);

  const playNewOrderTone = useCallback(async () => {
    const audioContext = await ensureAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;

    const playBeep = (startAt: number, frequency: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);

      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(0.2, startAt + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    };

    playBeep(now, 880, 0.12);
    playBeep(now + 0.16, 1175, 0.14);
  }, [ensureAudioContext]);

  // -- CREATING ORDER AND ORDER ITEMS --
  // Handle WebSocket events for real-time updates
  const handleOrderItemCreated = useCallback((data: { orderItem: OrderItem }) => {
    const orderItemId = Number(data.orderItem.order_item_id);

    if (orderItemIdsRef.current.has(orderItemId)) {
      return;
    }

    setOrderItems((prev) => [...prev, data.orderItem]);
    orderItemIdsRef.current.add(orderItemId);

    if (data.orderItem.status === "INCOMING") {
      setNewIncomingIds((prev) => {
        const next = new Set(prev);
        next.add(orderItemId);
        return next;
      });
      void playNewOrderTone();
    }
  }, [playNewOrderTone]);

  const handleOrderItemUpdated = useCallback((data: { orderItem: OrderItem }) => {
    setOrderItems((prev) =>
      prev.map((item) =>
        item.order_item_id === data.orderItem.order_item_id ? data.orderItem : item
      )
    );

    if (data.orderItem.status !== "INCOMING") {
      setNewIncomingIds((prev) => {
        if (!prev.has(data.orderItem.order_item_id)) return prev;
        const next = new Set(prev);
        next.delete(data.orderItem.order_item_id);
        return next;
      });
    }
  }, []);

  // Join stall room and set up WebSocket listeners
  useEffect(() => {
    if (!socket || !isConnected || !stallId) return;

    const numericStallId = Number(stallId);
    joinStall(numericStallId);

    socket.on('order_item_created', handleOrderItemCreated);
    socket.on('order_item_updated', handleOrderItemUpdated);

    return () => {
      socket.off('order_item_created', handleOrderItemCreated);
      socket.off('order_item_updated', handleOrderItemUpdated);
      leaveStall(numericStallId);
    };
  }, [socket, isConnected, stallId, joinStall, leaveStall, handleOrderItemCreated, handleOrderItemUpdated]);

  useEffect(() => {
    const unlockAudio = () => {
      void ensureAudioContext();
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [ensureAudioContext]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (previousStatusRef.current === "INCOMING" && selectedStatus !== "INCOMING") {
      setNewIncomingIds(new Set());
    }
    previousStatusRef.current = selectedStatus;
  }, [selectedStatus]);

  const createOrderItem = async (
    data: {
      itemName: string;
      quantity: string;
      unitPrice: string;
      notes?: string;
      table: string;
      volunteerName: string;
    }
  ) => {
    try {
      const payload = {
        stall_id: Number(stallId),
        table_id: Number(data.table),
        order_item_name: data.itemName,
        status: "INCOMING" as const,
        quantity: Number(data.quantity),
        price: Number(data.unitPrice),
        remarks: data.notes || "",
        volunteer_name: data.volunteerName
      };
      const json = await api.createCustomOrder(payload);

      if (!json) {
        throw new Error("Failed to create order item");
      } else {
        getOrderItemsByStall();
      }
    } catch (error: any) {
      setError(error.message);
    }
  };

  const fetchMenuItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const items = await api.getItemsByStall(Number(stallId));
      setMenuItems(items);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoadingItems(false);
    }
  }, [stallId]);

  const toggleItemAvailability = async (itemId: number) => {
    if (togglingItemIds.has(itemId)) return;
    setTogglingItemIds((prev) => new Set(prev).add(itemId));
    try {
      const updated = await api.toggleItemAvailability(itemId);
      setMenuItems((prev) =>
        prev.map((it) => (it.item_id === itemId ? { ...it, is_available: updated.is_available } : it))
      );
    } catch (error: any) {
      setError(error.message);
    } finally {
      setTogglingItemIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  // Fetch items when showItems toggles on
  useEffect(() => {
    if (showItems && menuItems.length === 0) {
      fetchMenuItems();
    }
  }, [showItems, fetchMenuItems, menuItems.length]);

  // Update order item status
  const updateOrderItemStatus = async (orderItemId: number, type: "STANDARD" | "CUSTOM") => {
    if (updatingItemIds.has(orderItemId)) return;

    try {
      setUpdatingItemIds((prev) => {
        const next = new Set(prev);
        next.add(orderItemId);
        return next;
      });

      const updatedOrderItem = await api.updateOrderItemStatus(orderItemId, type);

      // Optimistically update local state so the card moves categories immediately.
      setOrderItems((prev) =>
        prev.map((item) =>
          item.order_item_id === orderItemId ? { ...item, ...updatedOrderItem } : item
        )
      );

      setSelectedOrderItem((prev) =>
        prev && prev.order_item_id === orderItemId ? { ...prev, ...updatedOrderItem } : prev
      );
    } catch (error: any) {
      setError(error.message);
    } finally {
      setUpdatingItemIds((prev) => {
        const next = new Set(prev);
        next.delete(orderItemId);
        return next;
      });
    }
  };

  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent, orderItemId: number) => {
    const touch = e.touches[0];
    setSwipeState(prev => ({
      ...prev,
      [orderItemId]: {
        x: 0,
        startX: touch.clientX,
        isSwiping: true
      }
    }));
  };

  const handleTouchMove = (e: React.TouchEvent, orderItemId: number) => {
    const state = swipeState[orderItemId];
    if (!state?.isSwiping) return;

    const touch = e.touches[0];
    const diff = touch.clientX - state.startX;
    
    // Only allow right swipe (positive diff)
    if (diff > 0) {
      setSwipeState(prev => ({
        ...prev,
        [orderItemId]: {
          ...state,
          x: Math.min(diff, 150) // Cap at 150px
        }
      }));
    }
  };

  const handleTouchEnd = async (orderItemId: number, type: "STANDARD" | "CUSTOM") => {
    const state = swipeState[orderItemId];
    if (!state) return;

    // If swiped more than 100px, trigger status update
    if (state.x > 100 && !updatingItemIds.has(orderItemId)) {
      await updateOrderItemStatus(orderItemId, type);
    }

    // Reset swipe state
    setSwipeState(prev => {
      const newState = { ...prev };
      delete newState[orderItemId];
      return newState;
    });
  };

  useEffect(() => {
    setLoading(true);
    getStall();
    getOrderItemsByStall();
    setLoading(false);
  }, [stallId, getStall, getOrderItemsByStall]);


  return (
    <div className="h-screen overflow-hidden bg-white font-sans text-slate-600 w-full flex flex-col">
      <div className="px-6 pt-8 pb-4 bg-white">
        <div className="flex items-center gap-4">
            <BackButton href={`/runner/venue/${venueId}/stall/selectstall`} />
            <h1 className="text-3xl font-bold text-slate-800">{stall?.name}</h1>
        </div>

        {/* Status Filter Row */}
        <div className="flex items-center gap-2 mt-4">
          <button 
          onClick={() => setSelectedStatus("INCOMING")}
            className={`px-4 py-1 rounded-lg text-sm font-medium shadow-sm ${
              selectedStatus === "INCOMING"
                ? "bg-green-700 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              Incoming
              {newIncomingIds.size > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {newIncomingIds.size}
                </span>
              )}
            </span>
          </button>
          <button 
          onClick={() => setSelectedStatus("PREPARING")}
            className={`px-4 py-1 rounded-lg text-sm font-medium shadow-sm gap-10 ${
              selectedStatus === "PREPARING"
                ? "bg-green-700 text-white hover:bg-green-800"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Preparing
          </button>
          <button 
          onClick={() => setSelectedStatus("SERVED")}
            className={`px-4 py-1 rounded-lg text-sm font-medium shadow-sm ${
              selectedStatus === "SERVED"
                ? "bg-green-700 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            Served
          </button>
          <div className="relative ml-auto">
            <button
              onClick={() => setShowMoreMenu(prev => !prev)}
              className="px-4 py-1 rounded-lg text-sm font-bold shadow-sm bg-gray-200 text-gray-700"
              aria-label="More options"
            >
              ...
            </button>
            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-52 rounded-lg bg-white shadow-lg border py-1 z-50">
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      setShowAddOrder(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Add Custom Order
                  </button>
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      setShowItems(prev => !prev);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Toggle Item Availability
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-20 no-scrollbar">
        {showItems ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Item Availability</h2>
              <button
                onClick={() => setShowItems(false)}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 shadow-sm"
              >
                ← Back
              </button>
            </div>
            {loadingItems ? (
              <p className="pt-4">Loading items...</p>
            ) : menuItems.length === 0 ? (
              <p className="text-sm text-gray-500 pt-4">No items found for this stall</p>
            ) : (
              <>
                {menuItems
                  .filter((item) => item.is_available !== false)
                  .map((item) => (
                    <div
                      key={item.item_id}
                      className="flex justify-between items-center p-3 rounded-lg border bg-white shadow-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-sm text-gray-500">${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}</p>
                      </div>
                      <button
                        onClick={() => toggleItemAvailability(item.item_id)}
                        disabled={togglingItemIds.has(item.item_id)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          item.is_available !== false ? "bg-green-500" : "bg-gray-300"
                        } ${togglingItemIds.has(item.item_id) ? "opacity-50" : ""}`}
                        role="switch"
                        aria-checked={item.is_available !== false}
                        aria-label={item.is_available !== false ? "Mark sold out" : "Mark available"}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            item.is_available !== false ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  ))
                }
                {menuItems.filter((item) => item.is_available === false).length > 0 && (
                  <>
                    <h3 className="text-sm font-semibold text-gray-400 uppercase pt-4 pb-1">Unavailable</h3>
                    {menuItems
                      .filter((item) => item.is_available === false)
                      .map((item) => (
                        <div
                          key={item.item_id}
                          className="flex justify-between items-center p-3 rounded-lg border bg-gray-50 shadow-sm opacity-60"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate text-gray-400">{item.name}</p>
                            <p className="text-sm text-gray-400">${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}</p>
                          </div>
                          <button
                            onClick={() => toggleItemAvailability(item.item_id)}
                            disabled={togglingItemIds.has(item.item_id)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              item.is_available !== false ? "bg-green-500" : "bg-gray-300"
                            } ${togglingItemIds.has(item.item_id) ? "opacity-50" : ""}`}
                            role="switch"
                            aria-checked={item.is_available !== false}
                            aria-label={item.is_available !== false ? "Mark sold out" : "Mark available"}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                item.is_available !== false ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      ))
                    }
                  </>
                )}
              </>
            )}
          </div>
        ) : loading ? (
          <p className="pt-4">Loading...</p>
        ) : error ? (
          <p className="text-red-500 pt-4">Error: {error}</p>
        ) : (
          <div className="mt-4 space-y-2">
            {filteredOrderItems.length === 0 && !loading && (
              <p className="text-sm text-gray-500">
                No order item {selectedStatus.toLowerCase()}
              </p>
            )}
            {/* Sort the order items by created_at in descending order */}
            {filteredOrderItems
              .slice()
              .sort((a, b) => {
                const aTime = Number.isNaN(Date.parse(a.created_at)) ? 0 : Date.parse(a.created_at);
                const bTime = Number.isNaN(Date.parse(b.created_at)) ? 0 : Date.parse(b.created_at);
                return aTime - bTime;
              })
              .map((item) => {
                const swipe = swipeState[item.order_item_id] || { x: 0, isSwiping: false };
                const opacity = 1 - (swipe.x / 150) * 0.3;
                
                return (
              <div 
                key={item.order_item_id}
                className="relative overflow-visible"
              >
                {/* Background indicator */}
                {swipe.x > 0 && (
                  <div 
                    className="absolute inset-0 bg-green-700 flex items-center px-4 rounded-lg"
                    style={{ opacity: Math.min(swipe.x / 100, 1) }}
                  >
                    <span className="text-white font-semibold">
                      {swipe.x > 100 ? '✓ Release to update' : 'Swipe to next status →'}
                    </span>
                  </div>
                )}
                
                {/* Card */}
                <div
                  className="flex h-16 justify-between items-center p-3 rounded-lg border bg-white shadow-sm cursor-pointer relative"
                  style={{
                    transform: `translateX(${swipe.x}px)`,
                    transition: swipe.isSwiping ? 'none' : 'transform 0.3s ease-out',
                    opacity
                  }}
                  onTouchStart={(e) => handleTouchStart(e, item.order_item_id)}
                  onTouchMove={(e) => handleTouchMove(e, item.order_item_id)}
                  onTouchEnd={() => handleTouchEnd(item.order_item_id, item.type)}
                  onClick={
                    () => {
                      if (!swipe.isSwiping) {
                        setNewIncomingIds((prev) => {
                          if (!prev.has(item.order_item_id)) return prev;
                          const next = new Set(prev);
                          next.delete(item.order_item_id);
                          return next;
                        });
                        setSelectedOrderItem(item);
                        setShowOrderItemDetails(true);
                      }
                    }
                  }
                >
                {item.status === "INCOMING" && newIncomingIds.has(item.order_item_id) && (
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
                )}
                <div>
                  <p className="font-medium">
                    {item.order_item_name} <span className="bg-green-700 rounded px-1 text-white text-xs font-semibold">x{item.quantity}</span>
                  </p>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <p className="text-sm text-gray-600">
                      {item.modifiers.map(modifier => modifier.name).join(", ")}
                    </p>
                  )}
                  {item.remarks && (
                    <p className="text-sm text-gray-500 italic truncate">
                      {item.remarks}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="font-medium whitespace-nowrap">Table {item.table_number}</p>
                  <p className="text-xs text-gray-400">{item.order_id ? (String(item.order_id).startsWith('CUSTOM-') ? 'Custom' : `Order #${item.order_id}`) : ''}</p>
                  <p className="text-sm text-gray-600">{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
              </div>
            )})}
          </div>
        )}
        </div>
        <div>
        <AddOrderPanel
          open={showAddOrder}
          onClose={() => setShowAddOrder(false)}
          onSubmit={async (data) => {
            try {
              await createOrderItem(data);
            } catch (err) {
              console.error(err);
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
        </div>
        <div>
        <OrderItemDetails
          open={showOrderItemDetails}
          orderItem={selectedOrderItem}
          onClose={() => {
            setShowOrderItemDetails(false);
            setSelectedOrderItem(null);
            getOrderItemsByStall();
          }}
        />
        </div>
    </div>
  )
}
