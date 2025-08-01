"use client";

import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Poll, Order } from "@/types";
import {
  getPoll,
  getUserOrder,
  addOrder,
  updateUserOrder,
  deleteUserOrder,
  subscribeToOrders,
  subscribeToPoll,
  updatePoll,
  getUsers,
} from "@/lib/firestore";

export function useOrders(pollId: string, userId?: string) {
  const { toast } = useToast();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [userOrder, setUserOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const previousOrderingEndsAt = useRef<Date | undefined>(undefined);

  // Function to enrich orders with user names
  const enrichOrdersWithUserNames = async (ordersData: Order[]) => {
    const userIds = Array.from(
      new Set(ordersData.map((order) => order.userId)),
    );
    const users = await getUsers(userIds);
    const userMap = new Map(users.map((user) => [user.uid, user.name]));

    return ordersData.map((order) => ({
      ...order,
      userName: userMap.get(order.userId) || "Nieznany użytkownik",
    }));
  };

  useEffect(() => {
    if (!userId || !pollId) return;

    setLoading(true);

    const fetchInitialData = async () => {
      try {
        const pollData = await getPoll(pollId);
        if (!pollData) {
          toast({
            title: "Głosowanie usunięte",
            description: "To głosowanie zostało usunięte przez administratora.",
            variant: "destructive",
          });
          return;
        }

        setPoll(pollData);

        if (userId) {
          const userOrderData = await getUserOrder(pollId, userId);
          setUserOrder(userOrderData);
        }
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
    };

    fetchInitialData();

    // Set up real-time orders listener
    const unsubscribeOrders = subscribeToOrders(pollId, async (ordersData) => {
      const enrichedOrders = await enrichOrdersWithUserNames(ordersData);
      setOrders(enrichedOrders);
      setLoading(false);
    });

    // Set up real-time poll listener
    const unsubscribePoll = subscribeToPoll(pollId, (pollData) => {
      if (pollData) {
        const now = new Date();
        const currentOrderingEnded =
          pollData.orderingEndsAt && pollData.orderingEndsAt <= now;
        const previousOrderingEnded =
          previousOrderingEndsAt.current &&
          previousOrderingEndsAt.current <= now;

        if (currentOrderingEnded && !previousOrderingEnded) {
          toast({
            title: "Zamówienia zakończone",
            description: "Administrator zakończył przyjmowanie zamówień.",
            variant: "destructive",
          });
        }

        previousOrderingEndsAt.current = pollData.orderingEndsAt;
        setPoll(pollData);
      }
    });

    return () => {
      unsubscribeOrders();
      unsubscribePoll();
    };
  }, [pollId, userId, toast]);

  const submitOrder = async (data: {
    dish: string;
    notes?: string;
    cost: number;
  }) => {
    if (!userId || !poll) return;

    const now = new Date();
    const orderingEnded = poll.orderingEndsAt && poll.orderingEndsAt <= now;

    if (orderingEnded) {
      toast({
        title: "Czas minął",
        description:
          "Nie można już składać zamówień - czas składania zamówień dobiegł końca.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (userOrder) {
        // Update existing order
        await updateUserOrder(pollId, userId, data);
        setUserOrder({
          ...userOrder,
          dish: data.dish,
          notes: data.notes || "",
          cost: data.cost,
          createdAt: new Date(),
        });

        toast({
          title: "Zamówienie zaktualizowane",
          description: "Twoje zamówienie zostało pomyślnie zaktualizowane.",
        });
      } else {
        // Create new order
        const orderData: Order = {
          userId,
          dish: data.dish,
          notes: data.notes || "",
          cost: data.cost,
          createdAt: new Date(),
        };

        await addOrder(pollId, orderData);
        setUserOrder(orderData);

        toast({
          title: "Zamówienie złożone",
          description: "Twoje zamówienie zostało pomyślnie złożone.",
        });
      }
    } catch (error) {
      console.error("Error submitting order:", error);
      toast({
        title: "Błąd",
        description:
          "Nie udało się złożyć/zaktualizować zamówienia. Spróbuj ponownie.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const closeOrdering = async () => {
    if (!poll || !userId) return;

    try {
      const now = new Date();
      await updatePoll(pollId, {
        orderingEndsAt: now,
      });

      setPoll({ ...poll, orderingEndsAt: now });

      toast({
        title: "Zamówienia zakończone",
        description:
          "Składanie zamówień zostało zakończone przez administratora.",
      });
    } catch (error) {
      console.error("Error closing ordering:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się zakończyć składania zamówień.",
        variant: "destructive",
      });
    }
  };

  const deleteOrder = async () => {
    if (!userId || !userOrder) return;

    setSubmitting(true);
    try {
      await deleteUserOrder(pollId, userId);
      setUserOrder(null);

      toast({
        title: "Zamówienie usunięte",
        description: "Twoje zamówienie zostało usunięte.",
      });
    } catch (error) {
      console.error("Error deleting order:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się usunąć zamówienia. Spróbuj ponownie.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const updateOrder = async (orderIndex: number, updates: Partial<Order>) => {
    if (!poll || orderIndex < 0 || orderIndex >= orders.length) return;

    const orderToUpdate = orders[orderIndex];

    try {
      // Update order in Firestore with admin fields
      await updateUserOrder(pollId, orderToUpdate.userId, {
        ...orderToUpdate,
        ...updates,
      });

      toast({
        title: "Zamówienie zaktualizowane",
        description:
          "Zamówienie zostało pomyślnie zaktualizowane przez administratora.",
      });
    } catch (error) {
      console.error("Error updating order:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się zaktualizować zamówienia.",
        variant: "destructive",
      });
    }
  };

  const updateMenuUrl = async (url: string) => {
    if (!poll || !poll.selectedRestaurant) return;

    try {
      // Get current restaurant options and normalize them
      const currentOptions = poll.restaurantOptions || [];
      const normalizedOptions = currentOptions.map((option) => 
        typeof option === "string" ? { name: option } : option
      );

      // Update the URL for the selected restaurant
      const updatedOptions = normalizedOptions.map((option) => 
        option.name === poll.selectedRestaurant 
          ? { ...option, url: url || undefined }
          : option
      );

      await updatePoll(pollId, {
        restaurantOptions: updatedOptions,
      });

      setPoll({
        ...poll,
        restaurantOptions: updatedOptions,
      });

      toast({
        title: "Link zaktualizowany",
        description: "Link do menu został pomyślnie zaktualizowany.",
      });
    } catch (error) {
      console.error("Error updating menu URL:", error);
      toast({
        title: "Błąd",
        description: "Nie udało się zaktualizować linku do menu.",
        variant: "destructive",
      });
    }
  };

  const orderingEnded =
    poll?.orderingEndsAt &&
    poll.orderingEndsAt instanceof Date &&
    poll.orderingEndsAt <= new Date();

  const totalCost = orders.reduce((sum, order) => sum + order.cost, 0);

  return {
    poll,
    orders,
    userOrder,
    loading,
    submitting,
    orderingEnded: !!orderingEnded,
    totalCost,
    submitOrder,
    closeOrdering,
    deleteOrder,
    updateOrder,
    updateMenuUrl,
  };
}
